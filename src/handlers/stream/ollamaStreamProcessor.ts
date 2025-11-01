
import { logger } from "../../logging/index.js";
import { extractToolCallFromWrapper } from "../../parsers/xml/index.js";

import type {
  OpenAITool,
  StreamProcessor,
  ExtractedToolCall,
  OllamaResponse
} from "../../types/index.js";
import type { Response } from "express";

interface OllamaChunk extends OllamaResponse {
  response?: string;
  tool_calls?: Array<{
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
}

export class OllamaStreamProcessor implements StreamProcessor {
  public res: Response;
  private streamClosed: boolean = false;
  private knownToolNames: string[] = [];
  private isPotentialToolCall: boolean = false;
  private toolCallBuffer: string = "";
  private accumulatedContent: string = "";
  private toolCallDetectedAndHandled: boolean = false;
  private lastChunk: OllamaChunk | null = null;
  private readonly WRAPPER_START = '<toolbridge:calls>';
  private readonly WRAPPER_END = '</toolbridge:calls>';

  constructor(res: Response) {
    this.res = res;
    this.streamClosed = false;
    this.knownToolNames = [];
    this.isPotentialToolCall = false;
    this.toolCallBuffer = "";
    this.accumulatedContent = "";
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
  this.knownToolNames = (tools ?? []).map((t) => t.function.name).filter((name): name is string => Boolean(name));
    logger.debug(
      "[STREAM PROCESSOR] Known tool names set:",
      this.knownToolNames
    );
  }

  processChunk(chunk: Buffer | string): void {
    if (this.streamClosed || this.toolCallDetectedAndHandled) {return;}

  const chunkStr = chunk.toString();

    try {
      const chunkJson = JSON.parse(chunkStr) as OllamaChunk;
      this.lastChunk = chunkJson;

      if (chunkJson.response) {
        const resp = chunkJson.response;
        if (!this.isPotentialToolCall) {
          const startIdx = resp.indexOf(this.WRAPPER_START);
          if (startIdx !== -1) {
            // Send any text before wrapper
            const before = resp.substring(0, startIdx);
            if (before) {
              this.accumulatedContent += before;
              const contentChunk: OllamaChunk = { ...chunkJson, response: this.accumulatedContent };
              this.res.write(JSON.stringify(contentChunk) + "\n");
              this.accumulatedContent = "";
            }
            this.isPotentialToolCall = true;
            this.toolCallBuffer = resp.substring(startIdx);
            logger.debug("[STREAM PROCESSOR] Ollama: Detected wrapper start, buffering tool call");
          } else {
            // No wrapper start; treat as normal content
            this.accumulatedContent += resp;
            const contentChunk: OllamaChunk = { ...chunkJson, response: this.accumulatedContent };
            this.res.write(JSON.stringify(contentChunk) + "\n");
            this.accumulatedContent = "";
          }
        } else {
          // Already buffering
          this.toolCallBuffer += resp;
        }

        if (this.isPotentialToolCall && this.toolCallBuffer.includes(this.WRAPPER_END)) {
          logger.debug("[STREAM PROCESSOR] Ollama: Complete wrapper detected. Extracting tool call...");
          try {
            const toolCall: ExtractedToolCall | null = extractToolCallFromWrapper(this.toolCallBuffer, this.knownToolNames);
            if (toolCall?.name) {
              logger.debug(`[STREAM PROCESSOR] Successfully parsed Ollama tool call: ${toolCall.name}`);

              if (this.accumulatedContent) {
                const contentChunk: OllamaChunk = { ...this.lastChunk, response: this.accumulatedContent } as OllamaChunk;
                this.res.write(JSON.stringify(contentChunk) + "\n");
                this.accumulatedContent = "";
              }

              const ollamaToolCall: OllamaChunk = {
                ...this.lastChunk,
                tool_calls: [
                  {
                    function: {
                      name: toolCall.name,
                      arguments: (typeof toolCall.arguments === 'object') ? toolCall.arguments : {},
                    },
                  },
                ],
                response: "",
              } as OllamaChunk;

              this.res.write(JSON.stringify(ollamaToolCall) + "\n");

              this.resetToolCallState();
              this.toolCallDetectedAndHandled = true;
            } else {
              logger.debug("[STREAM PROCESSOR] Not a valid wrapped tool call, flushing as text");
              this.flushBufferAsText();
            }
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.debug("[STREAM PROCESSOR] Error parsing wrapped tool call:", errorMessage);
            this.flushBufferAsText();
          }
        }
      } else {
        this.res.write(chunkStr);
        if (!chunkStr.endsWith("\n")) {
          this.res.write("\n");
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.debug("Error parsing Ollama response:", errorMessage);

      this.res.write(chunkStr);
      if (!chunkStr.endsWith("\n")) {
        this.res.write("\n");
      }
    }
  }

  private flushBufferAsText(): void {
    if (this.toolCallBuffer) {
      logger.debug("[STREAM PROCESSOR] Flushing tool call buffer as text");
      this.accumulatedContent += this.toolCallBuffer;

      const lastChunkSafe = this.lastChunk ?? ({} as OllamaChunk);

      const contentChunk: OllamaChunk = {
        ...lastChunkSafe,
        response: this.accumulatedContent,
      };

      this.res.write(JSON.stringify(contentChunk) + "\n");
      this.accumulatedContent = "";
    }
    this.resetToolCallState();
  }

  private resetToolCallState(): void {
    this.isPotentialToolCall = false;
    this.toolCallBuffer = "";
  }

  end(): void {
    if (this.streamClosed) {return;}

  if (this.isPotentialToolCall && this.toolCallBuffer) {
      logger.debug(
        "[STREAM PROCESSOR] Processing buffered tool call at stream end"
      );

      try {
    const toolCall: ExtractedToolCall | null = extractToolCallFromWrapper(this.toolCallBuffer, this.knownToolNames);

        if (toolCall?.name) {
          if (this.accumulatedContent) {
            const lastChunkSafe = this.lastChunk ?? ({} as OllamaChunk);
            const contentChunk: OllamaChunk = {
              ...lastChunkSafe,
              response: this.accumulatedContent,
            };
            this.res.write(JSON.stringify(contentChunk) + "\n");
            this.accumulatedContent = "";
          }

          const lastChunkSafe = this.lastChunk ?? ({} as OllamaChunk);

          const ollamaToolCall: OllamaChunk = {
            ...lastChunkSafe,
            tool_calls: [
              {
                function: {
                  name: toolCall.name,
                  arguments: (typeof toolCall.arguments === 'object') 
                    ? toolCall.arguments
                    : {},
                },
              },
            ],
            response: "",
          };

          this.res.write(JSON.stringify(ollamaToolCall) + "\n");
        } else {
          this.flushBufferAsText();
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.debug(
          "[STREAM PROCESSOR] Error parsing final tool call:",
          errorMessage
        );
        this.flushBufferAsText();
      }
    } else if (this.accumulatedContent) {
      const lastChunkSafe = this.lastChunk ?? ({} as OllamaChunk);
      const contentChunk: OllamaChunk = {
        ...lastChunkSafe,
        response: this.accumulatedContent,
      };
      this.res.write(JSON.stringify(contentChunk) + "\n");
    }

    logger.debug("[STREAM PROCESSOR] Ollama backend stream ended.");
    if (!this.res.writableEnded) {
      this.res.end();
    }
    this.streamClosed = true;
  }


  closeStreamWithError(errorMessage: string): void {
    logger.error(
      `[STREAM PROCESSOR] Closing stream with error: ${errorMessage}`
    );
    if (!this.streamClosed && !this.res.writableEnded) {
      if (!this.res.headersSent) {
        this.res.status(500).json({
          error: {
            message: errorMessage,
            code: "STREAM_ERROR",
          },
        });
      } else {
        this.res.end();
      }
      this.streamClosed = true;
      logger.debug("[STREAM PROCESSOR] Client stream closed due to error.");
    }
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