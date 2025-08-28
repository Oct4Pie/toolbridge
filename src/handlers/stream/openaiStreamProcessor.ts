import logger from "../../utils/logger.js";
import {
  createChatStreamChunk,
  createFunctionCallStreamChunks,
  formatSSEChunk,
} from "../../utils/sseUtils.js";
import { extractToolCallXMLParser } from "../../utils/xmlUtils.js";
import { detectPotentialToolCall } from "../toolCallHandler.js";

import type {
  OpenAITool,
  OpenAIStreamChunk,
} from "../../types/openai.js";
import type {
  StreamProcessor,
  ToolCallDetectionResult,
  ExtractedToolCall,
} from "../../types/toolbridge.js";
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
  private isPotentialToolCall: boolean;
  private toolCallBuffer: string;
  private accumulatedContentBeforeToolCall: string;
  private toolCallDetectedAndHandled: boolean;
  private readonly jsonParser: JsonStreamParser;

  constructor(res: Response) {
    this.res = res;
    this.streamClosed = false;
    this.model = null;
    this.knownToolNames = [];

    logger.debug("[STREAM PROCESSOR] Initialized OpenAIStreamProcessor");
    this.isPotentialToolCall = false;
    this.toolCallBuffer = "";
    this.accumulatedContentBeforeToolCall = "";
    this.toolCallDetectedAndHandled = false;

    this.jsonParser = new JsonStreamParser((json: unknown) => {
      this.handleParsedChunk(json as OpenAIStreamChunk);
    });

    logger.debug("[STREAM PROCESSOR] Initialized custom JSON stream parser");
  }

  setTools(tools?: OpenAITool[]): void {
  this.knownToolNames = (tools ?? []).map((t) => t.function.name).filter((n): n is string => Boolean(n));
    logger.debug(
      "[STREAM PROCESSOR] Known tool names set:",
      this.knownToolNames
    );
  }

  processChunk(chunk: Buffer | string): void {
    if (this.streamClosed || this.toolCallDetectedAndHandled) {return;}

    const chunkString = chunk.toString("utf-8");
    logger.debug(
      `[STREAM PROCESSOR] Processing chunk (${chunkString.length} bytes)`
    );

    const lines = chunkString.split("\n").filter((line) => line.trim() !== "");

    for (const line of lines) {
      if (this.toolCallDetectedAndHandled) {break;}

      if (line.startsWith("data: ")) {
        const data = line.substring(6).trim();

        if (data === "[DONE]") {
          logger.debug("[STREAM PROCESSOR] Received [DONE] signal");
          this.handleDone();
          continue;
        }

        this.jsonParser.write(data);
      } else if (line.startsWith(": ")) {
        // SSE comment - ignore per SSE specification (OpenRouter timeout prevention)
        logger.debug("[STREAM PROCESSOR] Ignoring SSE comment:", line.substring(0, 50));
        continue;
      } else if (line.trim()) {
        logger.debug("[STREAM PROCESSOR] Received non-SSE line:", line);
        this.jsonParser.write(line);
      }
    }
  }

  private handleParsedChunk(parsedChunk: OpenAIStreamChunk): void {
    if (this.streamClosed || this.toolCallDetectedAndHandled) {return;}

    logger.debug("[STREAM PROCESSOR] Successfully parsed JSON chunk");

    try {
      if (parsedChunk.model) {
        this.model = parsedChunk.model;
      }

      if (parsedChunk.choices.length === 0) {
        logger.warn("[STREAM PROCESSOR] Response contained no choices");
        this.handleNoChoicesError();
        return;
      }

      // choices are present due to the guard above; narrow to a local variable
      const choice = parsedChunk.choices[0];

      let contentDelta: string | undefined = (choice.delta as { content?: unknown }).content as string | undefined;
      
      // Handle nested SSE format from OpenRouter - content contains "data: {json}"
      if (contentDelta?.includes('data: {')) {
        try {
          let extractedContent = '';
          
          // Split by SSE data lines and extract content from each
          const dataLines = contentDelta.split('\n\n').filter(line => line.startsWith('data: '));
          
          for (const dataLine of dataLines) {
            try {
              const nestedJsonStr = dataLine.substring(6); // Remove "data: " prefix
              const nestedJson = JSON.parse(nestedJsonStr);
              
              if (nestedJson.choices?.[0]?.delta?.content !== undefined) {
                extractedContent += nestedJson.choices[0].delta.content;
                
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
        const xmlStartInDelta = contentDelta.indexOf("<");
        const hasPotentialStartTag = xmlStartInDelta !== -1;

        if (!this.isPotentialToolCall && hasPotentialStartTag) {
          const textBeforeXml = contentDelta.substring(0, xmlStartInDelta);
          const xmlPortion = contentDelta.substring(xmlStartInDelta);

          if (textBeforeXml.length > 0) {
            logger.debug(
              "[STREAM PROCESSOR] Found text before potential XML:",
              textBeforeXml
            );
            this.accumulatedContentBeforeToolCall += textBeforeXml;
            logger.debug(
              "[STREAM PROCESSOR] Buffering text before XML, will send if needed"
            );
          }

          this.toolCallBuffer = xmlPortion;

          const isLikelyPartialTag = !xmlPortion.includes(">") || (xmlPortion.includes("<") && xmlPortion.includes("_"));

          if (isLikelyPartialTag) {
            logger.debug(
              "[STREAM PROCESSOR] Detected likely partial XML tag - buffering without validation"
            );
            this.isPotentialToolCall = true;
            return;
          }

          const potential: ToolCallDetectionResult = detectPotentialToolCall(
            xmlPortion,
            this.knownToolNames
          );

          const rootTag = potential.rootTagName ?? "";

          if (
            (potential.isPotential && potential.mightBeToolCall) ||
            (rootTag && this.knownToolNames.some((t) => t.includes(rootTag) || rootTag.includes("_")))
          ) {
            this.isPotentialToolCall = true;
            logger.debug(
              `[STREAM PROCESSOR] Started buffering potential tool (${rootTag}) - Buffer size: ${this.toolCallBuffer.length} chars`
            );
            return;
          } else {
            logger.debug(
              "[STREAM PROCESSOR] XML content does not match known tools, treating as regular content"
            );
            this.accumulatedContentBeforeToolCall += xmlPortion;
            this.sendSseChunk(parsedChunk);
            return;
          }
        }

        if (this.isPotentialToolCall) {
          this.toolCallBuffer += contentDelta;
          const potential: ToolCallDetectionResult = detectPotentialToolCall(
            this.toolCallBuffer,
            this.knownToolNames
          );

          logger.debug(
            `[STREAM PROCESSOR] Buffering potential tool - Buffer size: ${this.toolCallBuffer.length} chars`
          );

          if (potential.isCompletedXml) {
            logger.debug(
              "[STREAM PROCESSOR] Completed potential tool XML detected. Extracting..."
            );

            const xmlStartIndex = this.toolCallBuffer.indexOf("<");
            let xmlContent = this.toolCallBuffer;
            let textBeforeXml = "";

              if (xmlStartIndex > 0) {
                textBeforeXml = this.toolCallBuffer.substring(0, xmlStartIndex);
                xmlContent = this.toolCallBuffer.substring(xmlStartIndex);
                logger.debug("[STREAM PROCESSOR] Found text before XML in buffer:", textBeforeXml);

        if (textBeforeXml.length > 0) {
          this.accumulatedContentBeforeToolCall += textBeforeXml;
                  logger.debug("[STREAM PROCESSOR] Added text before XML to accumulated buffer");
                }
              }

            try {
                const toolCall: ExtractedToolCall | null = extractToolCallXMLParser(xmlContent, this.knownToolNames);

            if (toolCall?.name) {
                logger.debug(
                  `[STREAM PROCESSOR] Successfully parsed tool call: ${toolCall.name}`
                );
                const chunkId = parsedChunk.id;
                const chunkModel = parsedChunk.model;
                const handled = this.handleDetectedToolCall({
                  id: chunkId,
                  model: chunkModel,
                  xmlContent,
                  toolCall,
                });
                if (!handled) {
                  this.flushBufferAsText(parsedChunk);
                }
              } else {
                logger.debug(
                  "[STREAM PROCESSOR] Failed to parse as tool call, flushing as text"
                );
                this.flushBufferAsText(parsedChunk);
                
              }
            } catch (error) {
              logger.debug(
                "[STREAM PROCESSOR] Error parsing tool call:",
                error
              );
              this.flushBufferAsText(parsedChunk);
              
            }
          }

          
        } else {
          this.accumulatedContentBeforeToolCall += contentDelta;
          this.sendSseChunk(parsedChunk);
        }
      } else {
        if (this.isPotentialToolCall && this.toolCallBuffer.length > 0) {
          const handled = this.handleDetectedToolCall(parsedChunk);
          if (handled) {
            this.toolCallDetectedAndHandled = true;
            return;
          } else {
            this.flushBufferAsText(parsedChunk);
          }
        }

        if (!this.toolCallDetectedAndHandled) {
          this.sendSseChunk(parsedChunk);
        }
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

    if (this.isPotentialToolCall && this.toolCallBuffer) {
      logger.debug(
        "[STREAM PROCESSOR] Received [DONE] while buffering potential tool call."
      );

      const xmlStartIndex = this.toolCallBuffer.indexOf("<");
      let xmlContent = this.toolCallBuffer;
      let textBeforeXml = "";

      if (xmlStartIndex > 0) {
        textBeforeXml = this.toolCallBuffer.substring(0, xmlStartIndex);
        xmlContent = this.toolCallBuffer.substring(xmlStartIndex);
        logger.debug(
          "[STREAM PROCESSOR] Found text before XML:",
          textBeforeXml
        );
      }

      try {
        const toolCall: ExtractedToolCall | null = extractToolCallXMLParser(
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
  const xmlToProcess = lastChunk?.xmlContent ?? this.toolCallBuffer;

    logger.debug(
      "[STREAM PROCESSOR] Attempting to handle detected tool call XML:",
      xmlToProcess
    );

    try {
      const toolCall: ExtractedToolCall | null = extractToolCallXMLParser(
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

      const functionCallChunks = createFunctionCallStreamChunks(
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

      this.res.write("data: [DONE]\n\n");
      logger.debug(
        "[STREAM PROCESSOR] Sent final [DONE] signal after tool call"
      );

      this.resetToolCallState();
      this.toolCallDetectedAndHandled = true;
      this.end();
      logger.debug(
        "[STREAM PROCESSOR] Tool call successfully handled, stream closed."
      );
      return true;
    } catch (error) {
      logger.error("[STREAM PROCESSOR] Error handling tool call:", error);
      return false;
    }
  }

  private flushBufferAsText(referenceChunk: OpenAIStreamChunk): void {
    logger.warn(
      "[STREAM PROCESSOR] Flushing tool call buffer as text:",
      this.toolCallBuffer
    );
    if (this.toolCallBuffer) {
    const textChunk = createChatStreamChunk(
  referenceChunk.id,
  this.model || referenceChunk.model,
        this.toolCallBuffer,
        null
      );
      const sseString = formatSSEChunk(textChunk);

      this.res.write(sseString);

      this.accumulatedContentBeforeToolCall += this.toolCallBuffer;
    }
    this.resetToolCallState();
  }

  private flushAccumulatedTextAsChunk(id: string | null = null): void {
    if (this.accumulatedContentBeforeToolCall) {
      const textChunk = createChatStreamChunk(
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

  private resetToolCallState(): void {
    this.isPotentialToolCall = false;
    this.toolCallBuffer = "";
  }

  private resetAllBuffers(): void {
    this.resetToolCallState();
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
    logger.error(
      `[STREAM PROCESSOR] Closing stream with error: ${errorMessage}`
    );
    if (!this.streamClosed && !this.res.writableEnded) {
      this.closeStream(JSON.stringify({
        object: "error",
        message: errorMessage,
        type: "proxy_stream_error",
        code: null,
        param: null,
      }));
    }
  }

  private handleNoChoicesError(): void {
    logger.warn(
      "[STREAM PROCESSOR] Response contained no choices error detected"
    );

    if (!this.accumulatedContentBeforeToolCall && !this.toolCallBuffer) {
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