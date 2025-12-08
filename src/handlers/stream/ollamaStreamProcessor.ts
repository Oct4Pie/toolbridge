
import { config } from "../../config.js";
import { logger } from "../../logging/index.js";
import { attemptPartialToolCallExtraction } from "../../parsers/xml/index.js";
import { extractToolNames } from "../../translation/utils/formatUtils.js";
import {
  extractErrorMessage,
  handleStreamingBackendError,
} from "../../utils/http/errorResponseHandler.js";

import type {
  OpenAITool,
  StreamProcessor,
  OllamaStreamChunkFields
} from "../../types/index.js";
import type { Response } from "express";

type OllamaChunk = OllamaStreamChunkFields & {
  response?: string;
  tool_calls?: Array<{
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
};

export class OllamaStreamProcessor implements StreamProcessor {
  public res: Response;
  private streamClosed: boolean = false;
  private knownToolNames: string[] = [];
  private unifiedBuffer: string = ""; // SSOT parser accumulation buffer
  private partialToolCallState: import("../../types/index.js").PartialToolCallState | null = null;
  private toolCallDetectedAndHandled: boolean = false;
  private lastChunk: OllamaChunk | null = null;

  constructor(res: Response) {
    this.res = res;
    this.streamClosed = false;
    this.knownToolNames = [];
    this.unifiedBuffer = "";
    this.partialToolCallState = null;
    this.toolCallDetectedAndHandled = false;
    this.lastChunk = null;

    logger.debug(
      "[STREAM PROCESSOR] Initialized OllamaStreamProcessor with tool call buffering"
    );

    this.res.setHeader("Content-Type", "application/x-ndjson");
    this.res.setHeader("Cache-Control", "no-cache");
    this.res.setHeader("Connection", "keep-alive");
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

    // Do not drop chunks after tool call detection; always forward done.

  const chunkStr = chunk.toString();

    try {
      const chunkJson = JSON.parse(chunkStr) as OllamaChunk;
      this.lastChunk = chunkJson;

      // Check if this is a done message
      if (chunkJson.done === true) {
        logger.debug("[STREAM PROCESSOR] Ollama: Received done=true signal from backend");
        
        // CRITICAL: Before forwarding done, try final tool call extraction from buffer
        if (!this.toolCallDetectedAndHandled && this.unifiedBuffer && this.knownToolNames.length > 0) {
          const finalExtraction = attemptPartialToolCallExtraction(
            this.unifiedBuffer,
            this.knownToolNames,
            this.partialToolCallState
          );

          if (finalExtraction.complete && finalExtraction.toolCall) {
            const xmlContent = finalExtraction.content ?? "";
            const idx = this.unifiedBuffer.indexOf(xmlContent);
            const preface = idx > 0 ? this.unifiedBuffer.substring(0, idx) : "";
            
            if (preface) {
              const contentChunk: OllamaChunk = { ...chunkJson, response: preface, done: false } as OllamaChunk;
              this.res.write(JSON.stringify(contentChunk) + "\n");
            }

            // Emit tool call
            const ollamaToolCall: OllamaChunk = {
              ...chunkJson,
              tool_calls: [{ function: { name: finalExtraction.toolCall.name, arguments: (typeof finalExtraction.toolCall.arguments === 'object') ? finalExtraction.toolCall.arguments : {} } }],
              response: "",
              done: false,
            } as OllamaChunk;
            this.res.write(JSON.stringify(ollamaToolCall) + "\n");
            
            this.toolCallDetectedAndHandled = true;
            this.unifiedBuffer = "";
            this.partialToolCallState = null;
            logger.debug("[STREAM PROCESSOR] Ollama: Final tool call extracted before done signal");
          }
        }
        
        // Now forward the done signal
        this.res.write(chunkStr);
        if (!chunkStr.endsWith("\n")) {
          this.res.write("\n");
        }
        return; // Done signal forwarded
      }

      // SSOT partial extraction on response content
      if (!this.toolCallDetectedAndHandled && typeof chunkJson.response === 'string' && this.knownToolNames.length > 0) {
        const resp = chunkJson.response;
        this.unifiedBuffer += resp;

        const extraction = attemptPartialToolCallExtraction(
          this.unifiedBuffer,
          this.knownToolNames,
          this.partialToolCallState
        );

        if (extraction.complete && extraction.toolCall) {
          const xmlContent = extraction.content ?? "";
          const idx = this.unifiedBuffer.indexOf(xmlContent);

          // Send preface content if any
          const preface = idx > 0 ? this.unifiedBuffer.substring(0, idx) : "";
          if (preface) {
            const contentChunk: OllamaChunk = { ...chunkJson, response: preface } as OllamaChunk;
            this.res.write(JSON.stringify(contentChunk) + "\n");
          }

          // Emit Ollama tool_calls
          const ollamaToolCall: OllamaChunk = {
            ...this.lastChunk,
            tool_calls: [{ function: { name: extraction.toolCall.name, arguments: (typeof extraction.toolCall.arguments === 'object') ? extraction.toolCall.arguments : {} } }],
            response: "",
            done: false,
          } as OllamaChunk;
          this.res.write(JSON.stringify(ollamaToolCall) + "\n");

          this.toolCallDetectedAndHandled = true;
          const endPos = idx + xmlContent.length;
          this.unifiedBuffer = endPos < this.unifiedBuffer.length ? this.unifiedBuffer.substring(endPos) : "";
          this.partialToolCallState = null;
          logger.debug("[STREAM PROCESSOR] Ollama: Tool call sent via SSOT parser");
        } else {
          this.partialToolCallState = extraction.partialState ?? null;
          if (!this.partialToolCallState?.mightBeToolCall) {
            if (this.unifiedBuffer) {
              const contentChunk: OllamaChunk = { ...chunkJson, response: this.unifiedBuffer } as OllamaChunk;
              this.res.write(JSON.stringify(contentChunk) + "\n");
              this.unifiedBuffer = "";
            }
          } else {
            const max = config.performance.maxToolCallBufferSize;
            if (this.unifiedBuffer.length > max) {
              this.unifiedBuffer = this.unifiedBuffer.slice(-max);
            }
          }
        }
      } else if (this.toolCallDetectedAndHandled) {
        // Tool call already sent, just forward remaining chunks (including done signal)
        logger.debug("[STREAM PROCESSOR] Ollama: Tool call already sent, forwarding chunk");
        this.res.write(chunkStr);
        if (!chunkStr.endsWith("\n")) {
          this.res.write("\n");
        }
      } else {
        // No response field, forward as-is
        this.res.write(chunkStr);
        if (!chunkStr.endsWith("\n")) {
          this.res.write("\n");
        }
      }
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      logger.debug("Error parsing Ollama response:", errorMessage);

      this.res.write(chunkStr);
      if (!chunkStr.endsWith("\n")) {
        this.res.write("\n");
      }
    }
  }

  private flushBufferAsText(): void {
    if (this.unifiedBuffer) {
      logger.debug("[STREAM PROCESSOR] Flushing unified buffer as text");
      const lastChunkSafe = this.lastChunk ?? ({} as OllamaChunk);
      const contentChunk: OllamaChunk = { ...lastChunkSafe, response: this.unifiedBuffer };
      this.res.write(JSON.stringify(contentChunk) + "\n");
      this.unifiedBuffer = "";
    }
    this.partialToolCallState = null;
  }

  end(): void {
    if (this.streamClosed) {return;}

  if (!this.toolCallDetectedAndHandled && this.unifiedBuffer) {
      logger.debug(
        "[STREAM PROCESSOR] Processing buffered tool call at stream end"
      );

      try {
        const finalExtraction = attemptPartialToolCallExtraction(this.unifiedBuffer, this.knownToolNames, this.partialToolCallState);

        if (finalExtraction.complete && finalExtraction.toolCall) {
          // Flush any preface text before the wrapper
          const xmlContent = finalExtraction.content ?? "";
          const idx = this.unifiedBuffer.indexOf(xmlContent);
          const preface = idx > 0 ? this.unifiedBuffer.substring(0, idx) : "";
          if (preface) {
            const lastChunkSafe = this.lastChunk ?? ({} as OllamaChunk);
            const contentChunk: OllamaChunk = { ...lastChunkSafe, response: preface, done: false };
            this.res.write(JSON.stringify(contentChunk) + "\n");
          }
          this.unifiedBuffer = "";

          const lastChunkSafe = this.lastChunk ?? ({} as OllamaChunk);

          const ollamaToolCall: OllamaChunk = {
            ...lastChunkSafe,
            tool_calls: [
              {
                function: {
                  name: finalExtraction.toolCall.name,
                  arguments: (typeof finalExtraction.toolCall.arguments === 'object')
                    ? finalExtraction.toolCall.arguments
                    : {},
                },
              },
            ],
            response: "",
            done: false, // Not done yet
          };

          this.res.write(JSON.stringify(ollamaToolCall) + "\n");

          // Send final done signal
          const doneChunk: OllamaChunk = {
            ...lastChunkSafe,
            response: "",
            done: true,
          };
          this.res.write(JSON.stringify(doneChunk) + "\n");
          logger.debug("[STREAM PROCESSOR] Sent final done=true signal after tool call");
        } else {
          this.flushBufferAsText();
        }
      } catch (error: unknown) {
        const errorMessage = extractErrorMessage(error);
        logger.debug(
          "[STREAM PROCESSOR] Error parsing final tool call:",
          errorMessage
        );
        this.flushBufferAsText();
      }
    } else if (this.unifiedBuffer) {
      const lastChunkSafe = this.lastChunk ?? ({} as OllamaChunk);
      const contentChunk: OllamaChunk = { ...lastChunkSafe, response: this.unifiedBuffer, done: false };
      this.res.write(JSON.stringify(contentChunk) + "\n");
      this.unifiedBuffer = "";
    }

    logger.debug("[STREAM PROCESSOR] Ollama backend stream ended.");
    if (!this.res.writableEnded) {
      this.res.end();
    }
    this.streamClosed = true;
  }


  closeStreamWithError(errorMessage: string): void {
    handleStreamingBackendError(
      this.res,
      new Error(errorMessage),
      'OLLAMA STREAM PROCESSOR',
      `Stream error: ${errorMessage}`
    );
    this.streamClosed = true;
  }

  closeStream(message: string | null = null): void {
    if (!this.streamClosed) {
      if (message) {
        logger.debug(`[STREAM PROCESSOR] Closing stream: ${message}`);
      }
      if (!this.res.writableEnded) {
        this.res.end();
      }
      this.streamClosed = true;
    }
  }

  handleDone(): void {
    this.end();
  }
}
