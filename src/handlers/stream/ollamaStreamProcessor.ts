
import logger from "../../utils/logger.js";
import { extractToolCallXMLParser } from "../../utils/xmlUtils.js";
import { detectPotentialToolCall } from "../toolCallHandler.js";

import type {
  OpenAITool,
  StreamProcessor,
  ExtractedToolCall,
  ToolCallDetectionResult,
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
        if (this.isPotentialToolCall) {
          this.toolCallBuffer += chunkJson.response;

          const potential: ToolCallDetectionResult = detectPotentialToolCall(
            this.toolCallBuffer,
            this.knownToolNames
          );

          logger.debug(
            `[STREAM PROCESSOR] Buffering potential tool - Buffer size: ${this.toolCallBuffer.length} chars`
          );

          if (potential.isCompletedXml) {
            logger.debug(
              "[STREAM PROCESSOR] Completed potential tool XML detected in Ollama response"
            );

            try {
              const toolCall: ExtractedToolCall | null = extractToolCallXMLParser(
                this.toolCallBuffer,
                this.knownToolNames
              );

              if (toolCall?.name) {
                logger.debug(
                  `[STREAM PROCESSOR] Successfully parsed Ollama tool call: ${toolCall.name}`
                );

                if (this.accumulatedContent) {
                  const contentChunk: OllamaChunk = {
                    ...this.lastChunk,
                    response: this.accumulatedContent,
                  };
                  this.res.write(JSON.stringify(contentChunk) + "\n");
                  this.accumulatedContent = "";
                }

                const ollamaToolCall: OllamaChunk = {
                  ...this.lastChunk,
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

                this.resetToolCallState();
                this.toolCallDetectedAndHandled = true;
                
              } else {
                logger.debug(
                  "[STREAM PROCESSOR] Not a valid tool call, flushing buffer as text"
                );
                this.flushBufferAsText();
              }
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              logger.debug(
                "[STREAM PROCESSOR] Error parsing tool call XML:",
                errorMessage
              );
              this.flushBufferAsText();
            }
          } else {
            
          }
        } else {
          const xmlIndex = chunkJson.response.indexOf("<");

          if (xmlIndex !== -1) {
            const textBeforeXml = chunkJson.response.substring(0, xmlIndex);
            const xmlPortion = chunkJson.response.substring(xmlIndex);

            if (textBeforeXml) {
              this.accumulatedContent += textBeforeXml;
            }

            const potential: ToolCallDetectionResult = detectPotentialToolCall(
              xmlPortion,
              this.knownToolNames
            );

            if (
              potential.isPotential ||
              (potential.rootTagName &&
                (() => {
                  const root = potential.rootTagName;
                  if (!root) {return false;}
                  return this.knownToolNames.some((t) => t.includes(root) || root.includes("_"));
                })()
              )
            ) {
              this.isPotentialToolCall = true;
              this.toolCallBuffer = xmlPortion;
              logger.debug(
                `[STREAM PROCESSOR] Started buffering potential Ollama tool call - Buffer: ${xmlPortion}`
              );
              
            } else {
              this.accumulatedContent += chunkJson.response;
              const contentChunk: OllamaChunk = {
                ...chunkJson,
                response: this.accumulatedContent,
              };
              this.res.write(JSON.stringify(contentChunk) + "\n");
              this.accumulatedContent = "";
            }
          } else {
            this.accumulatedContent += chunkJson.response;
            const contentChunk: OllamaChunk = {
              ...chunkJson,
              response: this.accumulatedContent,
            };
            this.res.write(JSON.stringify(contentChunk) + "\n");
            this.accumulatedContent = "";
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
        const toolCall: ExtractedToolCall | null = extractToolCallXMLParser(
          this.toolCallBuffer,
          this.knownToolNames
        );

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