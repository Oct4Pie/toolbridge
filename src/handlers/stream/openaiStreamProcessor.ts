import { config } from "../../config.js";
import { logger } from "../../logging/index.js";
import { attemptPartialToolCallExtraction, extractToolCallUnified } from "../../parsers/xml/index.js";
import { OpenAIConverter } from "../../translation/converters/openai-simple.js";
import { extractToolNames } from "../../translation/utils/formatUtils.js";
import { handleStreamingBackendError } from "../../utils/http/errorResponseHandler.js";
import { formatSSEChunk } from "../../utils/http/index.js";

import type {
  OpenAITool,
  OpenAIStreamChunk,
} from "../../types/openai.js";
import type { StreamProcessor, ExtractedToolCall, PartialToolCallState } from "../../types/toolbridge.js";
import type { Response } from "express";

type JsonParseCallback = (json: unknown) => void;

class JsonStreamParser {
  private buffer: string;
  private readonly onParse: JsonParseCallback;

  constructor(onParse: JsonParseCallback) {
    this.buffer = "";
    this.onParse = onParse;
  }

  write(chunk: string): void {
    this.buffer += chunk;
    this.tryParse();
  }

  private tryParse(): void {
    if (this.buffer.trim() !== "") {
      try {
        const json = JSON.parse(this.buffer);
        this.onParse(json);
        this.buffer = "";
        return;
      } catch (_e) {
        // fallthrough to heuristic recovery
      }
    }

    if (this.buffer.startsWith("t.completion.chunk")) {
      this.buffer = '{"objec' + this.buffer;
    } else if (this.buffer.startsWith("pletion.chunk")) {
      this.buffer = '{"object":"chat.com' + this.buffer;
    } else if (this.buffer.startsWith("ion.chunk")) {
      this.buffer = '{"object":"chat.complet' + this.buffer;
    } else if (this.buffer.startsWith(',"object"')) {
      this.buffer = '{"id":"fragment"' + this.buffer;
    } else if (this.buffer.startsWith('odel":')) {
      this.buffer = '{"m' + this.buffer;
    } else if (this.buffer.startsWith('oning-plus"')) {
      this.buffer = '{"model":"microsoft/Phi-4-reas' + this.buffer;
    } else if (this.buffer.startsWith("plet")) {
      this.buffer = '{"object":"chat.com' + this.buffer;
    }

    try {
      const json = JSON.parse(this.buffer);
      this.onParse(json);
      this.buffer = "";
    } catch (_e) {
      logger.debug("[STREAM PARSER] Incomplete JSON, waiting for more data");
    }
  }

  end(): void {
    if (this.buffer.trim() !== "") {
      try {
        const json = JSON.parse(this.buffer);
        this.onParse(json);
      } catch (_e) {
        logger.warn(
          "[STREAM PARSER] Discarding incomplete JSON at end of stream:",
          this.buffer.length > 50 ? this.buffer.substring(0, 50) + "..." : this.buffer,
        );
      }
      this.buffer = "";
    }
  }
}

interface LastChunk {
  id?: string | null | undefined;
  model?: string | undefined;
  xmlContent?: string | undefined;
  toolCall?: ExtractedToolCall | undefined;
}

export class OpenAIStreamProcessor implements StreamProcessor {
  public res: Response;
  private streamClosed: boolean;
  private model: string | null;
  private knownToolNames: string[];
  private unifiedBuffer: string;
  private partialToolCallState: PartialToolCallState | null;
  // Legacy fields retained previously are now removed per SSOT
  private accumulatedContentBeforeToolCall: string;
  private toolCallDetectedAndHandled: boolean;
  private readonly jsonParser: JsonStreamParser;
  private readonly converter: OpenAIConverter;

  constructor(res: Response) {
    this.res = res;
    this.streamClosed = false;
    this.model = null;
    this.knownToolNames = [];
    this.converter = new OpenAIConverter();

    logger.debug("[STREAM PROCESSOR] Initialized OpenAIStreamProcessor");
    this.unifiedBuffer = "";
    this.partialToolCallState = null;
    this.accumulatedContentBeforeToolCall = "";
    this.toolCallDetectedAndHandled = false;

    this.jsonParser = new JsonStreamParser((json: unknown) => {
      this.handleParsedChunk(json as OpenAIStreamChunk);
    });

    logger.debug("[STREAM PROCESSOR] Initialized custom JSON stream parser");
  }

  setTools(tools?: OpenAITool[]): void {
    // Use formatUtils SSOT for tool name extraction
    this.knownToolNames = extractToolNames(tools ?? []);
    logger.debug(
      "[STREAM PROCESSOR] Known tool names set:",
      this.knownToolNames
    );
  }

  processChunk(chunk: Buffer | string): void {
    if (this.streamClosed) {return;}

    // CRITICAL FIX: Don't drop chunks after tool call detection!
    // Backend may still send chunks including the final [DONE] signal.
    // Only skip tool call detection logic, not the entire chunk processing.

    const chunkString = chunk.toString("utf-8");
    logger.debug(
      `[STREAM PROCESSOR] Processing chunk (${chunkString.length} bytes)`
    );

    const lines = chunkString.split("\n").filter((line) => line.trim() !== "");

    for (const line of lines) {

      if (line.startsWith("data: ")) {
        const data = line.substring(6).trim();

        if (data === "[DONE]") {
          logger.debug("[STREAM PROCESSOR] Received [DONE] signal");
          this.handleDone();
          continue;
        }

        this.jsonParser.write(data);
      } else if (line.startsWith(": ")) {
        // SSE comment - ignore per SSE specification (compatibility with some OpenAI-compatible backends)
        logger.debug("[STREAM PROCESSOR] Ignoring SSE comment:", line.substring(0, 50));
        continue;
      } else if (line.trim()) {
        logger.debug("[STREAM PROCESSOR] Received non-SSE line:", line);
        this.jsonParser.write(line);
      }
    }
  }

  private handleParsedChunk(parsedChunk: OpenAIStreamChunk): void {
    if (this.streamClosed) {return;}

    // If tool call already handled, just forward chunks (for [DONE] signal)
    if (this.toolCallDetectedAndHandled) {
      logger.debug("[STREAM PROCESSOR] Tool call already handled, forwarding chunk");
      this.sendSseChunk(parsedChunk);
      return;
    }

    logger.debug("[STREAM PROCESSOR] Successfully parsed JSON chunk");

    try {
      if (parsedChunk.model) {
        this.model = parsedChunk.model;
      }

      // Handle test data that might not have proper choices structure
      if (!('choices' in parsedChunk) || !Array.isArray(parsedChunk.choices) || parsedChunk.choices.length === 0) {
        // Check if this is test data with a simple content property
        const testContent = (parsedChunk as { content?: string }).content;
        if (testContent) {
          logger.debug("[STREAM PROCESSOR] Detected test data format, processing content directly");
          this.sendSseChunk({
            id: (parsedChunk as { id?: string }).id ?? "test",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: this.model ?? "test-model",
            choices: [{
              index: 0,
              delta: { content: testContent },
              finish_reason: null
            }]
          });
          return;
        }
        
        logger.warn("[STREAM PROCESSOR] Response contained no valid choices or content");
        this.handleNoChoicesError();
        return;
      }

      if (parsedChunk.choices.length === 0) {
        logger.warn("[STREAM PROCESSOR] Response contained no choices");
        this.handleNoChoicesError();
        return;
      }

      // choices are present due to the guard above; narrow to a local variable
      const choice = parsedChunk.choices[0];
      if (!choice) {
        this.handleNoChoicesError();
        return;
      }

      let contentDelta: string | undefined = (choice.delta as { content?: unknown }).content as string | undefined;
      
      // Handle nested SSE format from OpenAI-compatible backends - content contains "data: {json}"
      if ((contentDelta?.includes('data: {')) ?? false) {
        try {
          let extractedContent = '';
          const cd = contentDelta as string;
          // Split by SSE data lines and extract content from each
          const dataLines = cd.split('\n\n').filter(line => line.startsWith('data: '));
          
          for (const dataLine of dataLines) {
            try {
              const nestedJsonStr = dataLine.substring(6); // Remove "data: " prefix
              const nestedJson = JSON.parse(nestedJsonStr);
              
              if (nestedJson.choices?.[0]?.delta?.content !== undefined) {
                extractedContent += nestedJson.choices[0].delta.content as string;
                
                // Update model if available in nested response
                if (nestedJson.model && !this.model) {
                  this.model = nestedJson.model;
                }
              }
            } catch (_e) {
              logger.debug("[STREAM PROCESSOR] Failed to parse nested JSON line:", (_e as Error).message);
            }
          }
          
          if (extractedContent) {
            logger.debug("[STREAM PROCESSOR] Extracted content from nested SSE format:", extractedContent);
            contentDelta = extractedContent;
          }
  } catch (_e) {
          logger.debug("[STREAM PROCESSOR] Failed to parse nested SSE format, using content as-is");
          // If nested parsing fails, use the original content
        }
      }
      if (contentDelta) {
        // SSOT partial extraction
        this.unifiedBuffer += contentDelta;
        const extraction = attemptPartialToolCallExtraction(
          this.unifiedBuffer,
          this.knownToolNames,
          this.partialToolCallState
        );

        if (extraction.complete && extraction.toolCall) {
          const xmlContent = extraction.content ?? "";
          const idx = this.unifiedBuffer.indexOf(xmlContent);
          const preface = idx > 0 ? this.unifiedBuffer.substring(0, idx) : "";
          if (preface) {
            this.accumulatedContentBeforeToolCall += preface;
            this.flushAccumulatedTextAsChunk(parsedChunk.id ?? null);
          }

          const handled = this.handleDetectedToolCall({
            id: parsedChunk.id,
            model: parsedChunk.model,
            xmlContent,
            toolCall: extraction.toolCall,
          });
          if (handled) {
            this.toolCallDetectedAndHandled = true;
            const endPos = idx + xmlContent.length;
            const remainder = endPos < this.unifiedBuffer.length ? this.unifiedBuffer.substring(endPos) : "";
            this.unifiedBuffer = remainder;
            this.partialToolCallState = null;
            return;
          }
        }

        this.partialToolCallState = extraction.partialState ?? null;
        if (!this.partialToolCallState?.mightBeToolCall) {
          // Not a potential tool call; forward content
          this.accumulatedContentBeforeToolCall += this.unifiedBuffer;
          this.flushAccumulatedTextAsChunk(parsedChunk.id ?? null);
          this.unifiedBuffer = "";
          this.sendSseChunk(parsedChunk);
        } else {
          // Keep buffering
          const max = config.performance.maxToolCallBufferSize;
          if (this.unifiedBuffer.length > max) {
            this.unifiedBuffer = this.unifiedBuffer.slice(-max);
          }
        }
      } else {
        if (this.partialToolCallState?.mightBeToolCall) {
          logger.debug("[STREAM PROCESSOR] Holding non-content chunk while buffering potential tool call");
          return;
        }
        this.sendSseChunk(parsedChunk);
      }
    } catch (error) {
      logger.error("[STREAM PROCESSOR] Error handling parsed chunk:", error);
    }
  }

  private sendSseChunk(chunk: OpenAIStreamChunk): void {
    const sseString = formatSSEChunk(chunk);
    this.res.write(sseString);
  }

  handleDone(): void {
    logger.debug("[STREAM PROCESSOR] Processing [DONE] signal");

    this.jsonParser.end();

    if (this.partialToolCallState?.mightBeToolCall && this.unifiedBuffer) {
      logger.debug(
        "[STREAM PROCESSOR] Received [DONE] while buffering potential tool call."
      );

      const xmlStartIndex = this.unifiedBuffer.indexOf("<");
      let xmlContent = this.unifiedBuffer;
      let textBeforeXml = "";

      if (xmlStartIndex > 0) {
        textBeforeXml = this.unifiedBuffer.substring(0, xmlStartIndex);
        xmlContent = this.unifiedBuffer.substring(xmlStartIndex);
        logger.debug(
          "[STREAM PROCESSOR] Found text before XML:",
          textBeforeXml
        );
      }

      try {
        // SSOT: Use unified extraction (tries wrapper first, then direct extraction)
        const toolCall: ExtractedToolCall | null = extractToolCallUnified(
          xmlContent,
          this.knownToolNames
        );

        if (toolCall?.name) {
          logger.debug(
            `[STREAM PROCESSOR] Valid tool call found at end of stream: ${toolCall.name}`
          );

      if (textBeforeXml.length > 0) {
        this.accumulatedContentBeforeToolCall += textBeforeXml;
        this.flushAccumulatedTextAsChunk();
          }

          const handled = this.handleDetectedToolCall({
            id: null,
            model: this.model ?? undefined,
            xmlContent: xmlContent,
            toolCall: toolCall,
          });

          if (handled) {
            // Tool call was handled, now send [DONE] since backend's stream ended
            this.res.write("data: [DONE]\n\n");
            this.end();
            return;
          }
        }
      } catch (error) {
        logger.debug(
          "[STREAM PROCESSOR] Error parsing XML at end of stream:",
          error
        );
      }
    }

    if (this.accumulatedContentBeforeToolCall) {
      logger.debug(
        "[STREAM PROCESSOR] Flushing accumulated text before DONE:",
        this.accumulatedContentBeforeToolCall
      );
      this.flushAccumulatedTextAsChunk();
    }

    if (!this.toolCallDetectedAndHandled) {
      this.res.write("data: [DONE]\n\n");
    }

    this.end();
  }

  private handleDetectedToolCall(lastChunk?: LastChunk): boolean {
  const xmlToProcess = lastChunk?.xmlContent ?? this.unifiedBuffer;

    logger.debug(
      "[STREAM PROCESSOR] Attempting to handle detected tool call XML:",
      xmlToProcess
    );

    try {
      // SSOT: Use unified extraction (tries wrapper first, then direct extraction)
      const toolCall: ExtractedToolCall | null = extractToolCallUnified(
        xmlToProcess,
        this.knownToolNames
      );

      if (!toolCall?.name) {
        logger.warn(
          "[STREAM PROCESSOR] Failed to parse buffered XML as tool call - parser returned:",
          toolCall
        );
        return false;
      }

      logger.debug(
        `[STREAM PROCESSOR] Successfully parsed XML tool call: ${toolCall.name}`
      );
      logger.debug(
        `[STREAM PROCESSOR] Tool call arguments:`,
        JSON.stringify(toolCall.arguments, null, 2)
      );

      if (this.accumulatedContentBeforeToolCall) {
        const prefacePatterns = [
          "I'll",
          "I will",
          "Let me",
          "Here's",
          "Here is",
          "I'm going to",
          "Let's",
          "I can",
          "I am going to",
        ];

        const isLikelyToolCallPreface = prefacePatterns.some((pattern) =>
          this.accumulatedContentBeforeToolCall.includes(pattern)
        );

                if (isLikelyToolCallPreface) {
          logger.debug(
            "[STREAM PROCESSOR] Detected likely tool call preface text, not sending separately:",
            this.accumulatedContentBeforeToolCall
          );

          this.accumulatedContentBeforeToolCall = "";
        } else {
          logger.debug(
            "[STREAM PROCESSOR] Sending accumulated text before tool call:",
            this.accumulatedContentBeforeToolCall
          );
          this.flushAccumulatedTextAsChunk(lastChunk?.id ?? null);
        }
      }

      const functionCallChunks = this.converter.createToolCallStreamSequence(
        toolCall,
        lastChunk?.id ?? null,
        this.model ?? lastChunk?.model ?? null
      );

      functionCallChunks.forEach((chunk) => {
        const sseString = formatSSEChunk(chunk);
        logger.debug(
          "[STREAM PROCESSOR] Sending Tool Call Chunk:",
          JSON.stringify(chunk, null, 2)
        );
        this.res.write(sseString);
      });

      // CRITICAL FIX: Don't send [DONE] here! Let backend's done signal propagate naturally.
      // Sending [DONE] immediately causes client to think stream is complete,
      // but we need to wait for backend's natural [DONE] signal to properly close the stream.
      // This was causing clients to loop because stream never properly completed.

      this.unifiedBuffer = "";
      this.partialToolCallState = null;
      this.toolCallDetectedAndHandled = true;
      logger.debug(
        "[STREAM PROCESSOR] Tool call successfully handled, continuing to process backend [DONE] signal"
      );
      return true;
    } catch (error) {
      logger.error("[STREAM PROCESSOR] Error handling tool call:", error);
      return false;
    }
  }

  // Legacy flush removed (unifiedBuffer path handles text flushing)

  private flushAccumulatedTextAsChunk(id: string | null = null): void {
    if (this.accumulatedContentBeforeToolCall) {
      const textChunk = this.converter.createStreamChunk(
        id,
        this.model,
        this.accumulatedContentBeforeToolCall,
        null
      );
      const sseString = formatSSEChunk(textChunk);
      this.res.write(sseString);
      this.accumulatedContentBeforeToolCall = "";
    }
  }

  // No separate reset; unifiedBuffer + partialToolCallState are the SSOT

  private resetAllBuffers(): void {
    this.unifiedBuffer = "";
    this.partialToolCallState = null;
    this.accumulatedContentBeforeToolCall = "";
  }

  end(): void {
    if (!this.streamClosed && !this.res.writableEnded) {
      this.resetAllBuffers();
      logger.debug("[STREAM PROCESSOR] OpenAI backend stream ended normally.");
      this.closeStream();
    }
  }

  closeStream(message: string | null = null): void {
    if (!this.streamClosed && !this.res.writableEnded) {
      if (message) {
        const errorPayload =
          typeof message === "object" ? message : { error: message };
        this.res.write(formatSSEChunk(errorPayload));
      }
      this.res.end();
      this.streamClosed = true;
      logger.debug("[STREAM PROCESSOR] Client stream closed.");
    }
  }

  closeStreamWithError(errorMessage: string): void {
    handleStreamingBackendError(
      this.res,
      new Error(errorMessage),
      'OPENAI STREAM PROCESSOR',
      `Stream error: ${errorMessage}`
    );
    this.streamClosed = true;
  }

  private handleNoChoicesError(): void {
    logger.warn(
      "[STREAM PROCESSOR] Response contained no choices error detected"
    );

    if (!this.accumulatedContentBeforeToolCall && !this.unifiedBuffer) {
      const syntheticResponse: OpenAIStreamChunk = {
        id: "synthetic_response",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
  model: this.model ?? "unknown",
        choices: [
          {
            index: 0,
            delta: {
              content:
                "I received your message but could not generate a response. Please try again.",
            },
            finish_reason: null,
          },
        ],
      };

      const sseString = `data: ${JSON.stringify(syntheticResponse)}\n\n`;
      this.res.write(sseString);
    }
  }
}
