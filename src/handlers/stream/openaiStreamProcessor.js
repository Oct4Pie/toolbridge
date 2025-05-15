import logger from "../../utils/logger.js";
import {
  createChatStreamChunk,
  createFunctionCallStreamChunks,
  formatSSEChunk,
} from "../../utils/sseUtils.js";
import { extractToolCallXMLParser } from "../../utils/xmlUtils.js";
import { detectPotentialToolCall } from "../toolCallHandler.js";

class JsonStreamParser {
  constructor(onParse) {
    this.buffer = "";
    this.onParse = onParse;
    this.balanceBraces = 0;
    this.inString = false;
    this.escaped = false;
  }

  write(chunk) {
    this.buffer += chunk;
    this.tryParse();
  }

  tryParse() {
    if (this.buffer.trim() !== "") {
      try {
        const json = JSON.parse(this.buffer);
        this.onParse(json);
        this.buffer = "";
        return;
      } catch (e) {}
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
    } catch (e) {
      logger.debug("[STREAM PARSER] Incomplete JSON, waiting for more data");
    }
  }

  end() {
    if (this.buffer.trim() !== "") {
      try {
        const json = JSON.parse(this.buffer);
        this.onParse(json);
      } catch (e) {
        logger.warn(
          "[STREAM PARSER] Discarding incomplete JSON at end of stream:",
          this.buffer.length > 50
            ? this.buffer.substring(0, 50) + "..."
            : this.buffer
        );
      }
      this.buffer = "";
    }
  }
}

export class OpenAIStreamProcessor {
  constructor(res) {
    this.res = res;
    this.streamClosed = false;
    this.model = null;
    this.knownToolNames = [];

    logger.debug("[STREAM PROCESSOR] Initialized OpenAIStreamProcessor");
    this.isPotentialToolCall = false;
    this.toolCallBuffer = "";
    this.accumulatedContentBeforeToolCall = "";
    this.toolCallDetectedAndHandled = false;

    this.jsonParser = new JsonStreamParser((json) => {
      this.handleParsedChunk(json);
    });

    logger.debug("[STREAM PROCESSOR] Initialized custom JSON stream parser");
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

    const chunkString = chunk.toString("utf-8");
    logger.debug(
      `[STREAM PROCESSOR] Processing chunk (${chunkString.length} bytes)`
    );

    const lines = chunkString.split("\n").filter((line) => line.trim() !== "");

    for (const line of lines) {
      if (this.toolCallDetectedAndHandled) break;

      if (line.startsWith("data: ")) {
        const data = line.substring(6).trim();

        if (data === "[DONE]") {
          logger.debug("[STREAM PROCESSOR] Received [DONE] signal");
          this.handleDone();
          continue;
        }

        this.jsonParser.write(data);
      } else if (line.trim()) {
        logger.debug("[STREAM PROCESSOR] Received non-SSE line:", line);
        this.jsonParser.write(line);
      }
    }
  }

  handleParsedChunk(parsedChunk) {
    if (this.streamClosed || this.toolCallDetectedAndHandled) return;

    logger.debug("[STREAM PROCESSOR] Successfully parsed JSON chunk");

    try {
      if (parsedChunk.model) {
        this.model = parsedChunk.model;
      }

      if (!parsedChunk.choices || parsedChunk.choices.length === 0) {
        logger.warn("[STREAM PROCESSOR] Response contained no choices");
        this.handleNoChoicesError();
        return;
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
              textBeforeXml
            );
            this.accumulatedContentBeforeToolCall += textBeforeXml;
            logger.debug(
              "[STREAM PROCESSOR] Buffering text before XML, will send if needed"
            );
          }

          this.toolCallBuffer = xmlPortion;

          const isLikelyPartialTag =
            !xmlPortion.includes(">") ||
            (xmlPortion.includes("<") && xmlPortion.includes("_"));

          if (isLikelyPartialTag) {
            logger.debug(
              "[STREAM PROCESSOR] Detected likely partial XML tag - buffering without validation"
            );
            this.isPotentialToolCall = true;
            return;
          }

          const potential = detectPotentialToolCall(
            xmlPortion,
            this.knownToolNames
          );

          if (
            (potential.isPotential && potential.mightBeToolCall) ||
            (potential.rootTagName &&
              this.knownToolNames.some(
                (t) =>
                  t.includes(potential.rootTagName) ||
                  potential.rootTagName.includes("_")
              ))
          ) {
            this.isPotentialToolCall = true;
            logger.debug(
              `[STREAM PROCESSOR] Started buffering potential tool (${potential.rootTagName}) - Buffer size: ${this.toolCallBuffer.length} chars`
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
          const potential = detectPotentialToolCall(
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
              logger.debug(
                "[STREAM PROCESSOR] Found text before XML in buffer:",
                textBeforeXml
              );

              if (textBeforeXml) {
                this.accumulatedContentBeforeToolCall += textBeforeXml;
                logger.debug(
                  "[STREAM PROCESSOR] Added text before XML to accumulated buffer"
                );
              }
            }

            try {
              const toolCall = extractToolCallXMLParser(
                xmlContent,
                this.knownToolNames
              );

              if (toolCall && toolCall.name) {
                logger.debug(
                  `[STREAM PROCESSOR] Successfully parsed tool call: ${toolCall.name}`
                );
                const handled = this.handleDetectedToolCall({
                  id: parsedChunk?.id,
                  model: parsedChunk?.model || this.model,
                  xmlContent,
                  toolCall,
                });
                if (handled) {
                  return;
                } else {
                  this.flushBufferAsText(parsedChunk);
                  return;
                }
              } else {
                logger.debug(
                  "[STREAM PROCESSOR] Failed to parse as tool call, flushing as text"
                );
                this.flushBufferAsText(parsedChunk);
                return;
              }
            } catch (error) {
              logger.debug(
                "[STREAM PROCESSOR] Error parsing tool call:",
                error
              );
              this.flushBufferAsText(parsedChunk);
              return;
            }
          }

          return;
        } else {
          this.accumulatedContentBeforeToolCall += contentDelta;
          this.sendSseChunk(parsedChunk);
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
          if (!(finishReason === "stop" && this.toolCallDetectedAndHandled)) {
            this.sendSseChunk(parsedChunk);
          }
        }
      }
    } catch (error) {
      logger.error("[STREAM PROCESSOR] Error handling parsed chunk:", error);
    }
  }

  sendSseChunk(chunk) {
    const sseString = formatSSEChunk(chunk);
    this.res.write(sseString);
  }

  handleDone() {
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
        const toolCall = extractToolCallXMLParser(
          xmlContent,
          this.knownToolNames
        );

        if (toolCall && toolCall.name) {
          logger.debug(
            `[STREAM PROCESSOR] Valid tool call found at end of stream: ${toolCall.name}`
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

  handleDetectedToolCall(lastChunk) {
    const xmlToProcess = lastChunk?.xmlContent || this.toolCallBuffer;

    logger.debug(
      "[STREAM PROCESSOR] Attempting to handle detected tool call XML:",
      xmlToProcess
    );

    try {
      const toolCall = extractToolCallXMLParser(
        xmlToProcess,
        this.knownToolNames
      );

      if (!toolCall || !toolCall.name) {
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
          this.flushAccumulatedTextAsChunk(lastChunk?.id);
        }
      }

      const functionCallChunks = createFunctionCallStreamChunks(
        lastChunk?.id,
        this.model || lastChunk?.model,
        toolCall
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

  flushBufferAsText(referenceChunk) {
    logger.warn(
      "[STREAM PROCESSOR] Flushing tool call buffer as text:",
      this.toolCallBuffer
    );
    if (this.toolCallBuffer) {
      const textChunk = createChatStreamChunk(
        referenceChunk?.id,
        this.model || referenceChunk?.model,
        this.toolCallBuffer,
        null
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
        null
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
    this.jsonBuffer = "";
  }

  end() {
    if (!this.streamClosed && !this.res.writableEnded) {
      this.resetAllBuffers();
      logger.debug("[STREAM PROCESSOR] OpenAI backend stream ended normally.");
      this.closeStream();
    }
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
      `[STREAM PROCESSOR] Closing stream with error: ${errorMessage}`
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
      "[STREAM PROCESSOR] Response contained no choices error detected"
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
