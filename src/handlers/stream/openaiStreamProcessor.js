import logger from "../../utils/logger.js";
import {
  createChatStreamChunk,
  createFunctionCallStreamChunks,
  formatSSEChunk,
} from "../../utils/sseUtils.js";
import { extractToolCallXMLParser } from "../../utils/xmlUtils.js";
import { detectPotentialToolCall } from "../toolCallHandler.js";

export class OpenAIStreamProcessor {
  constructor(res) {
    this.res = res;
    this.streamClosed = false;
    this.model = null;
    this.knownToolNames = [];

    logger.debug(
      "[STREAM PROCESSOR] Initialized OpenAIStreamProcessor (XML Intercept)",
    );
    this.isPotentialToolCall = false;
    this.toolCallBuffer = "";
    this.accumulatedContentBeforeToolCall = "";
    this.toolCallDetectedAndHandled = false;
    this.incompleteJsonBuffer = "";

    this.jsonPayloadBuffer = "";

    this.inProgressObject = false;

    logger.debug(
      "[STREAM PROCESSOR] Initialized OpenAIStreamProcessor (XML Intercept)",
    );
  }

  setTools(tools) {
    this.knownToolNames =
      tools?.map((t) => t.function?.name).filter(Boolean) || [];
    logger.debug(
      "[STREAM PROCESSOR] Known tool names set:",
      this.knownToolNames,
    );
  }

  processChunk(chunk) {
    if (this.streamClosed || this.toolCallDetectedAndHandled) return;

    const chunkString = chunk.toString("utf-8");
    logger.debug(
      `[STREAM PROCESSOR] Processing chunk (${chunkString.length} bytes)`,
    );

    const lines = chunkString.split("\n").filter((line) => line.trim() !== "");

    for (const line of lines) {
      if (this.toolCallDetectedAndHandled) break;

      if (line.startsWith("data: ")) {
        let data = line.substring(6).trim();

        if (data === "[DONE]") {
          logger.debug("[STREAM PROCESSOR] Received [DONE] signal.");

          if (this.isPotentialToolCall && this.toolCallBuffer) {
            logger.debug(
              "[STREAM PROCESSOR] Received [DONE] while buffering potential tool call.",
            );
            logger.debug(
              "[STREAM PROCESSOR] Final buffer:",
              this.toolCallBuffer,
            );

            const xmlStartIndex = this.toolCallBuffer.indexOf("<");
            let xmlContent = this.toolCallBuffer;
            let textBeforeXml = "";

            if (xmlStartIndex > 0) {
              textBeforeXml = this.toolCallBuffer.substring(0, xmlStartIndex);
              xmlContent = this.toolCallBuffer.substring(xmlStartIndex);
              logger.debug(
                "[STREAM PROCESSOR] Found text before XML:",
                textBeforeXml,
              );
            }

            try {
              const toolCall = extractToolCallXMLParser(
                xmlContent,
                this.knownToolNames,
              );

              if (toolCall && toolCall.name) {
                logger.debug(
                  `[STREAM PROCESSOR] Valid tool call found at end of stream: ${toolCall.name}`,
                );

                if (textBeforeXml) {
                  this.accumulatedContentBeforeToolCall += textBeforeXml;
                  this.flushAccumulatedTextAsChunk();
                }

                const handled = this.handleDetectedToolCall({
                  id: null,
                  model: this.model,
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
                error,
              );
            }
          } else if (this.accumulatedContentBeforeToolCall) {
            logger.debug(
              "[STREAM PROCESSOR] Flushing accumulated text before DONE:",
              this.accumulatedContentBeforeToolCall,
            );

            // eslint-disable-next-line no-unused-vars
            let isDuplicate = false;

            this.flushAccumulatedTextAsChunk();
          }

          if (this.incompleteJsonBuffer) {
            logger.warn(
              "[STREAM PROCESSOR] Discarding incomplete JSON buffer at end of stream:",
              this.incompleteJsonBuffer.length > 50
                ? this.incompleteJsonBuffer.substring(0, 50) + "..."
                : this.incompleteJsonBuffer,
            );
            this.incompleteJsonBuffer = "";
          }

          if (!this.toolCallDetectedAndHandled) {
            this.res.write(line + "\n\n");
          }
          this.end();
          return;
        }

        if (this.incompleteJsonBuffer) {
          logger.debug(
            "[STREAM PROCESSOR] Appending to incomplete JSON buffer",
          );
          data = this.incompleteJsonBuffer + data;
          this.incompleteJsonBuffer = "";
        }

        try {
          const parsedChunk = JSON.parse(data);

          this.incompleteJsonBuffer = "";

          if (parsedChunk.model) {
            this.model = parsedChunk.model;
          }

          if (!parsedChunk.choices || parsedChunk.choices.length === 0) {
            logger.warn("[STREAM PROCESSOR] Response contained no choices");

            this.handleNoChoicesError();

            this.res.write(line + "\n\n");
            continue;
          }

          const contentDelta = parsedChunk.choices?.[0]?.delta?.content;
          const finishReason = parsedChunk.choices?.[0]?.finish_reason;

          if (contentDelta) {
            const updatedBuffer = this.toolCallBuffer + contentDelta;
            const xmlStartInDelta = contentDelta.indexOf("<");
            const hasPotentialStartTag = xmlStartInDelta !== -1;

            if (!this.isPotentialToolCall && hasPotentialStartTag) {
              const textBeforeXml = contentDelta.substring(0, xmlStartInDelta);
              const xmlPortion = contentDelta.substring(xmlStartInDelta);

              if (textBeforeXml) {
                logger.debug(
                  "[STREAM PROCESSOR] Found text before potential XML:",
                  textBeforeXml,
                );
                this.accumulatedContentBeforeToolCall += textBeforeXml;

                logger.debug(
                  "[STREAM PROCESSOR] Buffering text before XML, will send if needed",
                );
              }

              this.toolCallBuffer = xmlPortion;

              const isLikelyPartialTag =
                !xmlPortion.includes(">") ||
                (xmlPortion.includes("<") && xmlPortion.includes("_"));

              if (isLikelyPartialTag) {
                logger.debug(
                  "[STREAM PROCESSOR] Detected likely partial XML tag - buffering without validation",
                );
                this.isPotentialToolCall = true;
                continue;
              }

              const potential = detectPotentialToolCall(
                xmlPortion,
                this.knownToolNames,
              );

              if (
                (potential.isPotential && potential.mightBeToolCall) ||
                (potential.rootTagName &&
                  this.knownToolNames.some(
                    (t) =>
                      t.includes(potential.rootTagName) ||
                      potential.rootTagName.includes("_"),
                  ))
              ) {
                this.isPotentialToolCall = true;
                logger.debug(
                  `[STREAM PROCESSOR] Started buffering potential tool (${potential.rootTagName}) - Buffer size: ${this.toolCallBuffer.length} chars`,
                );
                continue;
              } else {
                logger.debug(
                  "[STREAM PROCESSOR] XML content does not match known tools, treating as regular content",
                );
                this.accumulatedContentBeforeToolCall += xmlPortion;
                this.res.write(line + "\n\n");
                continue;
              }
            }

            const potential = detectPotentialToolCall(
              updatedBuffer,
              this.knownToolNames,
            );

            if (
              (potential.isPotential && potential.mightBeToolCall) ||
              this.isPotentialToolCall
            ) {
              this.isPotentialToolCall = true;
              this.toolCallBuffer += contentDelta;

              logger.debug(
                `[STREAM PROCESSOR] Buffering potential tool (${potential.rootTagName}) - Buffer size: ${this.toolCallBuffer.length} chars`,
              );

              if (potential.isCompletedXml) {
                logger.debug(
                  "[STREAM PROCESSOR] Completed potential tool XML detected. Extracting...",
                );

                const xmlStartIndex = this.toolCallBuffer.indexOf("<");
                let xmlContent = this.toolCallBuffer;
                let textBeforeXml = "";

                if (xmlStartIndex > 0) {
                  textBeforeXml = this.toolCallBuffer.substring(
                    0,
                    xmlStartIndex,
                  );
                  xmlContent = this.toolCallBuffer.substring(xmlStartIndex);
                  logger.debug(
                    "[STREAM PROCESSOR] Found text before XML in buffer:",
                    textBeforeXml,
                  );

                  if (textBeforeXml) {
                    this.accumulatedContentBeforeToolCall += textBeforeXml;
                    logger.debug(
                      "[STREAM PROCESSOR] Added text before XML to accumulated buffer",
                    );
                  }
                }

                try {
                  const toolCall = extractToolCallXMLParser(
                    xmlContent,
                    this.knownToolNames,
                  );

                  if (toolCall && toolCall.name) {
                    logger.debug(
                      `[STREAM PROCESSOR] Successfully parsed tool call: ${toolCall.name}`,
                    );
                    const handled = this.handleDetectedToolCall({
                      id: parsedChunk?.id,
                      model: parsedChunk?.model || this.model,
                      xmlContent,
                      toolCall,
                    });
                    if (handled) {
                      continue;
                    } else {
                      this.flushBufferAsText(parsedChunk);
                      continue;
                    }
                  } else {
                    logger.debug(
                      "[STREAM PROCESSOR] Failed to parse as tool call, flushing as text",
                    );
                    this.flushBufferAsText(parsedChunk);
                    continue;
                  }
                } catch (error) {
                  logger.debug(
                    "[STREAM PROCESSOR] Error parsing tool call:",
                    error,
                  );
                  this.flushBufferAsText(parsedChunk);
                  continue;
                }
              } else {
                logger.debug(
                  "[STREAM PROCESSOR] XML not yet complete, continuing to buffer",
                );
                continue;
              }
            } else {
              this.accumulatedContentBeforeToolCall += contentDelta;
              this.res.write(line + "\n\n");
            }
          } else {
            if (this.isPotentialToolCall && this.toolCallBuffer) {
              const handled = this.handleDetectedToolCall(parsedChunk);
              if (handled) {
                this.toolCallDetectedAndHandled = true;
                return;
              } else {
                this.flushBufferAsText(parsedChunk);
              }
            }

            if (!this.toolCallDetectedAndHandled) {
              if (
                !(finishReason === "stop" && this.toolCallDetectedAndHandled)
              ) {
                this.res.write(line + "\n\n");
              }
            }
          }
        } catch (error) {
          logger.error(
            "[STREAM PROCESSOR] Error parsing OpenAI chunk data:",
            error,
            "Data:",
            data.length > 100 ? data.substring(0, 100) + "..." : data,
          );

          if (error instanceof SyntaxError) {
            const truncatedPatterns = [
              "Unterminated string",
              "Unexpected end of JSON input",
              "Unexpected token",
              "Unexpected non-whitespace character after JSON",
              "Expected double-quoted property name",
            ];

            const isTruncated = truncatedPatterns.some((pattern) =>
              error.message.includes(pattern),
            );

            if (isTruncated) {
              logger.warn(
                "[STREAM PROCESSOR] Detected incomplete JSON. Buffering for next chunk.",
              );

              if (this.incompleteJsonBuffer) {
                this.incompleteJsonBuffer += data;
              } else {
                this.incompleteJsonBuffer = data;
              }
              continue;
            }
          }

          logger.warn(
            "[STREAM PROCESSOR] Unknown JSON parsing error, clearing buffer and forwarding original data",
          );

          this.jsonPayloadBuffer = "";
          this.incompleteJsonBuffer = "";

          if (!this.toolCallDetectedAndHandled) {
            this.res.write(line + "\n\n");
          }
        }
      } else if (line.trim() && !line.startsWith("event:")) {
        logger.warn(
          "[STREAM PROCESSOR] Received non-SSE line from OpenAI backend:",
          line,
        );

        const isMissingStart =
          line.match(/^ect":"chat/) ||
          line.match(/^t":"chat/) ||
          line.match(/^":".+/) ||
          line.match(/^[a-z]+"/);

        if (isMissingStart) {
          logger.debug(
            "[STREAM PROCESSOR] Detected incomplete JSON fragment missing beginning",
          );

          if (line.match(/^ect":"chat/)) {
            const reconstructedLine = '{"obj' + line;
            logger.debug(
              "[STREAM PROCESSOR] Attempting to reconstruct JSON with prefix",
              reconstructedLine.substring(0, 20),
            );

            try {
              const parsedChunk = JSON.parse(reconstructedLine);
              logger.debug(
                "[STREAM PROCESSOR] Successfully reconstructed and parsed JSON",
              );

              this.jsonPayloadBuffer = "";
              this.incompleteJsonBuffer = "";

              this.processSuccessfullyParsedChunk(
                parsedChunk,
                reconstructedLine,
              );
              continue;
            } catch (_reconstructError) {
              logger.debug(
                "[STREAM PROCESSOR] Reconstruction failed, buffering fragment",
              );
            }
          }
        }

        this.jsonPayloadBuffer += line;
        logger.debug(
          "[STREAM PROCESSOR] Added non-SSE line to JSON buffer, current buffer:",
          this.jsonPayloadBuffer.length > 50
            ? this.jsonPayloadBuffer.substring(0, 50) + "..."
            : this.jsonPayloadBuffer,
        );

        if (this.incompleteJsonBuffer) {
          const combinedBuffer = this.incompleteJsonBuffer + line;
          logger.debug(
            "[STREAM PROCESSOR] Adding non-SSE line to incomplete JSON buffer",
          );

          try {
            const parsedIncompleteBuffer = JSON.parse(combinedBuffer);
            logger.debug(
              "[STREAM PROCESSOR] Successfully parsed combined JSON buffer",
            );

            this.incompleteJsonBuffer = "";
            this.jsonPayloadBuffer = "";

            this.processSuccessfullyParsedChunk(
              parsedIncompleteBuffer,
              combinedBuffer,
            );
            continue;
          } catch (_incompleteError) {
            if (
              this.incompleteJsonBuffer.endsWith('{"') &&
              line.match(/^[a-z]+"/)
            ) {
              const reconstructed = this.incompleteJsonBuffer + line;
              try {
                const parsedReconstructed = JSON.parse(reconstructed);
                logger.debug(
                  "[STREAM PROCESSOR] Successfully parsed reconstructed JSON",
                );
                this.incompleteJsonBuffer = "";
                this.jsonPayloadBuffer = "";

                this.processSuccessfullyParsedChunk(
                  parsedReconstructed,
                  reconstructed,
                );
                continue;
              } catch (_) {
                this.incompleteJsonBuffer = combinedBuffer;
              }
            } else {
              this.incompleteJsonBuffer = combinedBuffer;
              logger.debug(
                "[STREAM PROCESSOR] JSON still incomplete after adding non-SSE line",
              );
            }
          }
        } else {
          this.incompleteJsonBuffer = line;
        }

        try {
          const parsedChunk = JSON.parse(this.jsonPayloadBuffer);

          logger.debug(
            "[STREAM PROCESSOR] Successfully parsed JSON after adding non-SSE line",
          );
          this.jsonPayloadBuffer = "";
          this.incompleteJsonBuffer = "";

          this.processSuccessfullyParsedChunk(
            parsedChunk,
            this.jsonPayloadBuffer,
          );
        } catch (_fragmentError) {
          const reconstructions = [
            () => {
              if (this.jsonPayloadBuffer.match(/^ect":"chat/)) {
                return '{"obj' + this.jsonPayloadBuffer;
              }
              return null;
            },

            () => {
              if (this.jsonPayloadBuffer.match(/^t\.completion/)) {
                return '{"object":"cha' + this.jsonPayloadBuffer;
              }
              return null;
            },

            () => {
              if (this.jsonPayloadBuffer.match(/^t":"chat/)) {
                return '{"objec' + this.jsonPayloadBuffer;
              }
              return null;
            },

            () => {
              if (this.jsonPayloadBuffer.match(/^":"[^"]+"/)) {
                return '{"property' + this.jsonPayloadBuffer;
              }
              return null;
            },

            () => {
              const match = this.jsonPayloadBuffer.match(/^([a-z_]+"):/);
              if (match) {
                return "{" + this.jsonPayloadBuffer;
              }
              return null;
            },
          ];

          for (const reconstruct of reconstructions) {
            const reconstructed = reconstruct();
            if (reconstructed) {
              try {
                const parsedReconstructed = JSON.parse(reconstructed);
                logger.debug(
                  "[STREAM PROCESSOR] Successfully parsed reconstructed JSON buffer",
                );

                this.jsonPayloadBuffer = "";
                this.incompleteJsonBuffer = "";

                this.processSuccessfullyParsedChunk(
                  parsedReconstructed,
                  reconstructed,
                );
                break;
              } catch (_reconstructError) {
                logger.debug(
                  "[STREAM PROCESSOR] Reconstruction attempt failed",
                );
              }
            }
          }

          if (
            this.incompleteJsonBuffer &&
            this.incompleteJsonBuffer !== this.jsonPayloadBuffer
          ) {
            this.incompleteJsonBuffer = this.jsonPayloadBuffer;
          } else if (!this.incompleteJsonBuffer) {
            this.incompleteJsonBuffer = this.jsonPayloadBuffer;
          }

          if (
            this.incompleteJsonBuffer &&
            this.incompleteJsonBuffer.length > 1000
          ) {
            logger.warn(
              "[STREAM PROCESSOR] Incomplete JSON buffer growing too large, resetting to prevent memory issues",
            );

            try {
              const jsonStartIndex = this.incompleteJsonBuffer.indexOf("{");
              const jsonEndIndex = this.incompleteJsonBuffer.lastIndexOf("}");

              if (
                jsonStartIndex !== -1 &&
                jsonEndIndex !== -1 &&
                jsonEndIndex > jsonStartIndex
              ) {
                const potentialJson = this.incompleteJsonBuffer.substring(
                  jsonStartIndex,
                  jsonEndIndex + 1,
                );
                logger.debug(
                  "[STREAM PROCESSOR] Attempting to extract potential JSON substring",
                );

                try {
                  const parsed = JSON.parse(potentialJson);
                  logger.debug(
                    "[STREAM PROCESSOR] Successfully extracted valid JSON from buffer",
                  );
                  this.processSuccessfullyParsedChunk(parsed, potentialJson);
                } catch (_parseError) {
                  logger.debug(
                    "[STREAM PROCESSOR] Failed to parse extracted JSON",
                  );
                }
              }
            } catch (_extractionError) {
              logger.debug(
                "[STREAM PROCESSOR] Error while extracting JSON substring",
              );
            }

            this.incompleteJsonBuffer = "";
            this.jsonPayloadBuffer = "";
          }
        }
      }
    }
  }

  handleDetectedToolCall(lastChunk) {
    const xmlToProcess = lastChunk?.xmlContent || this.toolCallBuffer;

    logger.debug(
      "[STREAM PROCESSOR] Attempting to handle detected tool call XML:",
      xmlToProcess,
    );

    try {
      const toolCall = extractToolCallXMLParser(
        xmlToProcess,
        this.knownToolNames,
      );

      if (!toolCall || !toolCall.name) {
        logger.warn(
          "[STREAM PROCESSOR] Failed to parse buffered XML as tool call - parser returned:",
          toolCall,
        );
        return false;
      }

      logger.debug(
        `[STREAM PROCESSOR] Successfully parsed XML tool call: ${toolCall.name}`,
      );
      logger.debug(
        `[STREAM PROCESSOR] Tool call arguments:`,
        JSON.stringify(toolCall.arguments, null, 2),
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
          this.accumulatedContentBeforeToolCall.includes(pattern),
        );

        if (isLikelyToolCallPreface) {
          logger.debug(
            "[STREAM PROCESSOR] Detected likely tool call preface text, not sending separately:",
            this.accumulatedContentBeforeToolCall,
          );

          this.accumulatedContentBeforeToolCall = "";
        } else {
          logger.debug(
            "[STREAM PROCESSOR] Sending accumulated text before tool call:",
            this.accumulatedContentBeforeToolCall,
          );
          this.flushAccumulatedTextAsChunk(lastChunk?.id);
        }
      }

      const functionCallChunks = createFunctionCallStreamChunks(
        lastChunk?.id,
        this.model || lastChunk?.model,
        toolCall,
      );

      functionCallChunks.forEach((chunk) => {
        const sseString = formatSSEChunk(chunk);
        logger.debug(
          "[STREAM PROCESSOR] Sending Tool Call Chunk:",
          JSON.stringify(chunk, null, 2),
        );
        this.res.write(sseString);
      });

      this.res.write("data: [DONE]\n\n");
      logger.debug(
        "[STREAM PROCESSOR] Sent final [DONE] signal after tool call",
      );

      this.resetToolCallState();
      this.toolCallDetectedAndHandled = true;
      this.end();
      logger.debug(
        "[STREAM PROCESSOR] Tool call successfully handled, stream closed.",
      );
      return true;
    } catch (error) {
      logger.error("[STREAM PROCESSOR] Error handling tool call:", error);
      return false;
    }
  }

  flushBufferAsText(referenceChunk) {
    logger.warn(
      "[STREAM PROCESSOR] Flushing tool call buffer as text:",
      this.toolCallBuffer,
    );
    if (this.toolCallBuffer) {
      const textChunk = createChatStreamChunk(
        referenceChunk?.id,
        this.model || referenceChunk?.model,
        this.toolCallBuffer,
        null,
      );
      const sseString = formatSSEChunk(textChunk);

      this.res.write(sseString);

      this.accumulatedContentBeforeToolCall += this.toolCallBuffer;
    }
    this.resetToolCallState();
  }

  flushAccumulatedTextAsChunk(id = null) {
    if (this.accumulatedContentBeforeToolCall) {
      const textChunk = createChatStreamChunk(
        id,
        this.model,
        this.accumulatedContentBeforeToolCall,
        null,
      );
      const sseString = formatSSEChunk(textChunk);
      this.res.write(sseString);
      this.accumulatedContentBeforeToolCall = "";
    }
  }

  resetToolCallState() {
    this.isPotentialToolCall = false;
    this.toolCallBuffer = "";
  }

  resetAllBuffers() {
    this.resetToolCallState();
    this.accumulatedContentBeforeToolCall = "";
    this.incompleteJsonBuffer = "";
    this.jsonPayloadBuffer = "";
  }

  handleEndOfStreamWhileBuffering() {
    logger.debug(
      "[STREAM PROCESSOR] Stream ended while buffering potential tool call. Final check.",
    );
    logger.debug(
      "[STREAM PROCESSOR] Final tool buffer content:",
      this.toolCallBuffer,
    );

    if (this.jsonPayloadBuffer) {
      logger.debug(
        "[STREAM PROCESSOR] Final JSON payload buffer content:",
        this.jsonPayloadBuffer.length > 50
          ? this.jsonPayloadBuffer.substring(0, 50) + "..."
          : this.jsonPayloadBuffer,
      );

      try {
        const parsedJson = JSON.parse(this.jsonPayloadBuffer);
        logger.debug(
          "[STREAM PROCESSOR] Successfully parsed final buffered JSON",
        );

        const contentDelta = parsedJson.choices?.[0]?.delta?.content;
        if (contentDelta) {
          this.accumulatedContentBeforeToolCall += contentDelta;
        }
      } catch (_finalError) {
        logger.debug(
          "[STREAM PROCESSOR] Discarding incomplete JSON buffer at end of stream:",
          this.jsonPayloadBuffer.length > 50
            ? this.jsonPayloadBuffer.substring(0, 50) + "..."
            : this.jsonPayloadBuffer,
        );
      }
    }

    try {
      const handled = this.handleDetectedToolCall({
        id: null,
        model: this.model,
      });
      if (!handled) {
        logger.debug(
          "[STREAM PROCESSOR] Failed to handle tool call at end of stream",
        );
        this.flushBufferAsText({ id: null, model: this.model });
      } else {
        logger.debug(
          "[STREAM PROCESSOR] Successfully handled tool call at end of stream",
        );
      }
    } catch (error) {
      logger.error(
        "[STREAM PROCESSOR] Error handling XML at end of stream:",
        error,
      );
      this.flushBufferAsText({ id: null, model: this.model });
    }

    this.resetAllBuffers();

    if (!this.streamClosed && !this.res.writableEnded) {
      this.res.end();
      this.streamClosed = true;
      logger.debug(
        "[STREAM PROCESSOR] Stream closed after end-of-stream handling",
      );
    }
  }

  end() {
    if (
      !this.streamClosed &&
      !this.res.writableEnded &&
      !this.toolCallDetectedAndHandled
    ) {
      this.flushAccumulatedTextAsChunk();

      if (this.incompleteJsonBuffer) {
        logger.warn(
          "[STREAM PROCESSOR] Stream ended with incomplete JSON buffer:",
          this.incompleteJsonBuffer.length > 50
            ? this.incompleteJsonBuffer.substring(0, 50) + "..."
            : this.incompleteJsonBuffer,
        );
      }

      logger.debug("[STREAM PROCESSOR] OpenAI backend stream ended normally.");
      this.closeStream();
    } else if (
      this.toolCallDetectedAndHandled &&
      !this.streamClosed &&
      !this.res.writableEnded
    ) {
      logger.debug(
        "[STREAM PROCESSOR] Ensuring stream closure after tool call handling.",
      );
      this.res.end();
      this.streamClosed = true;
    }

    this.resetAllBuffers();
  }

  closeStream(message = null) {
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

  closeStreamWithError(errorMessage) {
    logger.error(
      `[STREAM PROCESSOR] Closing stream with error: ${errorMessage}`,
    );
    if (!this.streamClosed && !this.res.writableEnded) {
      this.closeStream({
        object: "error",
        message: errorMessage,
        type: "proxy_stream_error",
        code: null,
        param: null,
      });
    }
  }

  handleNoChoicesError() {
    logger.warn(
      "[STREAM PROCESSOR] Response contained no choices error detected",
    );

    if (!this.accumulatedContentBeforeToolCall && !this.toolCallBuffer) {
      const syntheticResponse = {
        id: "synthetic_response",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: this.model || "unknown",
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
