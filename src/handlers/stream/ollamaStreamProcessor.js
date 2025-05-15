import logger from "../../utils/logger.js";
import { extractToolCallXMLParser } from "../../utils/xmlUtils.js";
import { detectPotentialToolCall } from "../toolCallHandler.js";

export class OllamaStreamProcessor {
  constructor(res) {
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

  setTools(tools) {
    this.knownToolNames =
      tools?.map((t) => t.function?.name).filter(Boolean) || [];
    logger.debug(
      "[STREAM PROCESSOR] Known tool names set:",
      this.knownToolNames
    );
  }

  processChunk(chunk) {
    if (this.streamClosed || this.toolCallDetectedAndHandled) return;

    let chunkStr = chunk.toString();

    try {
      const chunkJson = JSON.parse(chunkStr);
      this.lastChunk = chunkJson;

      if (chunkJson.response) {
        if (this.isPotentialToolCall) {
          this.toolCallBuffer += chunkJson.response;

          const potential = detectPotentialToolCall(
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
              const toolCall = extractToolCallXMLParser(
                this.toolCallBuffer,
                this.knownToolNames
              );

              if (toolCall && toolCall.name) {
                logger.debug(
                  `[STREAM PROCESSOR] Successfully parsed Ollama tool call: ${toolCall.name}`
                );

                if (this.accumulatedContent) {
                  const contentChunk = {
                    ...this.lastChunk,
                    response: this.accumulatedContent,
                    tool_calls: null,
                  };
                  this.res.write(JSON.stringify(contentChunk) + "\n");
                  this.accumulatedContent = "";
                }

                const ollamaToolCall = {
                  ...this.lastChunk,
                  tool_calls: [
                    {
                      function: {
                        name: toolCall.name,
                        arguments: toolCall.arguments || {},
                      },
                    },
                  ],
                  response: "",
                };

                this.res.write(JSON.stringify(ollamaToolCall) + "\n");

                this.resetToolCallState();
                this.toolCallDetectedAndHandled = true;
                return;
              } else {
                logger.debug(
                  "[STREAM PROCESSOR] Not a valid tool call, flushing buffer as text"
                );
                this.flushBufferAsText();
              }
            } catch (error) {
              logger.debug(
                "[STREAM PROCESSOR] Error parsing tool call XML:",
                error
              );
              this.flushBufferAsText();
            }
          } else {
            return;
          }
        } else {
          const xmlIndex = chunkJson.response.indexOf("<");

          if (xmlIndex !== -1) {
            const textBeforeXml = chunkJson.response.substring(0, xmlIndex);
            const xmlPortion = chunkJson.response.substring(xmlIndex);

            if (textBeforeXml) {
              this.accumulatedContent += textBeforeXml;
            }

            const potential = detectPotentialToolCall(
              xmlPortion,
              this.knownToolNames
            );

            if (
              potential.isPotential ||
              (potential.rootTagName &&
                this.knownToolNames.some(
                  (t) =>
                    t.includes(potential.rootTagName) ||
                    potential.rootTagName.includes("_")
                ))
            ) {
              this.isPotentialToolCall = true;
              this.toolCallBuffer = xmlPortion;
              logger.debug(
                `[STREAM PROCESSOR] Started buffering potential Ollama tool call - Buffer: ${xmlPortion}`
              );
              return;
            } else {
              this.accumulatedContent += chunkJson.response;
              const contentChunk = {
                ...chunkJson,
                response: this.accumulatedContent,
              };
              this.res.write(JSON.stringify(contentChunk) + "\n");
              this.accumulatedContent = "";
            }
          } else {
            this.accumulatedContent += chunkJson.response;
            const contentChunk = {
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
    } catch (error) {
      logger.debug("Error parsing Ollama response:", error);

      this.res.write(chunkStr);
      if (!chunkStr.endsWith("\n")) {
        this.res.write("\n");
      }
    }
  }

  flushBufferAsText() {
    if (this.toolCallBuffer) {
      logger.debug("[STREAM PROCESSOR] Flushing tool call buffer as text");
      this.accumulatedContent += this.toolCallBuffer;

      const contentChunk = {
        ...this.lastChunk,
        response: this.accumulatedContent,
      };

      this.res.write(JSON.stringify(contentChunk) + "\n");
      this.accumulatedContent = "";
    }
    this.resetToolCallState();
  }

  resetToolCallState() {
    this.isPotentialToolCall = false;
    this.toolCallBuffer = "";
  }

  end() {
    if (this.streamClosed) return;

    if (this.isPotentialToolCall && this.toolCallBuffer) {
      logger.debug(
        "[STREAM PROCESSOR] Processing buffered tool call at stream end"
      );

      try {
        const toolCall = extractToolCallXMLParser(
          this.toolCallBuffer,
          this.knownToolNames
        );

        if (toolCall && toolCall.name) {
          if (this.accumulatedContent) {
            const contentChunk = {
              ...this.lastChunk,
              response: this.accumulatedContent,
              tool_calls: null,
            };
            this.res.write(JSON.stringify(contentChunk) + "\n");
            this.accumulatedContent = "";
          }

          const ollamaToolCall = {
            ...this.lastChunk,
            tool_calls: [
              {
                function: {
                  name: toolCall.name,
                  arguments: toolCall.arguments || {},
                },
              },
            ],
            response: "",
          };

          this.res.write(JSON.stringify(ollamaToolCall) + "\n");
        } else {
          this.flushBufferAsText();
        }
      } catch (error) {
        logger.debug(
          "[STREAM PROCESSOR] Error parsing final tool call:",
          error
        );
        this.flushBufferAsText();
      }
    } else if (this.accumulatedContent) {
      const contentChunk = {
        ...this.lastChunk,
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

  handleError(error) {
    if (this.streamClosed) return;
    logger.error(
      "[STREAM PROCESSOR] Error in Ollama backend stream:",
      error.message
    );
    if (!this.res.headersSent) {
      try {
        this.res.status(500).json({
          error: {
            message: `Stream processing error: ${error.message}`,
            code: "STREAM_ERROR",
          },
        });
      } catch (jsonError) {
        logger.error(
          "[STREAM PROCESSOR] Failed to send JSON error response:",
          jsonError.message
        );

        this.res.status(500).send(`Stream Error: ${error.message}`);
      }
    } else if (!this.res.writableEnded) {
      logger.debug(
        "[STREAM PROCESSOR] Ending client stream due to backend error (headers already sent)."
      );
      this.res.end();
    }
    this.streamClosed = true;
  }

  closeStreamWithError(errorMessage) {
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
}
