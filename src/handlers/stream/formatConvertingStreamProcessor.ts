
import { convertResponse } from "../../utils/formatConverters.js";
import logger from "../../utils/logger.js";
import { formatSSEChunk } from "../../utils/sseUtils.js";
import { extractToolCallFromWrapper } from "../../utils/xmlToolParser.js";
import { FORMAT_OLLAMA, FORMAT_OPENAI } from "../formatDetector.js";
// Wrappers-only policy: no unwrapped detection

import type {
  RequestFormat,
  OpenAITool,
  StreamProcessor,
  ExtractedToolCall,
  OpenAIStreamChunk,
  OpenAIResponse,
  OllamaResponse
} from "../../types/index.js";
import type { Response } from "express";

interface ReferenceChunk {
  model?: string | undefined;
  [key: string]: unknown;
}

interface OllamaToolCallResponse extends OllamaResponse {
  tool_calls: Array<{
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
  response: string;
}

export class FormatConvertingStreamProcessor implements StreamProcessor {
  public res: Response;
  private readonly sourceFormat: RequestFormat;
  private readonly targetFormat: RequestFormat;
  private buffer: string = "";
  private streamClosed: boolean = false;
  private isPotentialToolCall: boolean = false;
  private toolCallBuffer: string = "";
  private knownToolNames: string[] = [];
  private model: string | null = null;
  private readonly WRAPPER_START = '<toolbridge:calls>';
  private readonly WRAPPER_END = '</toolbridge:calls>';

  constructor(res: Response, sourceFormat: RequestFormat, targetFormat: RequestFormat) {
    this.res = res;
    this.sourceFormat = sourceFormat;
    this.targetFormat = targetFormat;
    this.buffer = "";
    this.streamClosed = false;
    this.isPotentialToolCall = false;
    this.toolCallBuffer = "";
    this.knownToolNames = [];
    this.model = null;
    
    logger.debug(
      `[STREAM PROCESSOR] Initialized FormatConvertingStreamProcessor (${sourceFormat} -> ${targetFormat})`,
    );

    const contentType =
      targetFormat === FORMAT_OPENAI
        ? "text/event-stream"
        : "application/x-ndjson";
    this.res.setHeader("Content-Type", contentType);
    this.res.setHeader("Cache-Control", "no-cache");
    this.res.setHeader("Connection", "keep-alive");
  }

  setTools(tools?: OpenAITool[]): void {
  this.knownToolNames = (tools ?? []).map((t) => t.function.name).filter((name): name is string => Boolean(name));
    logger.debug(
      "[STREAM PROCESSOR] FormatConverter known tool names set:",
      this.knownToolNames,
    );
  }

  processChunk(chunk: Buffer | string): void {
    if (this.streamClosed) {return;}

    const chunkStr = chunk.toString();
    logger.debug(
      `[STREAM PROCESSOR] FormatConverter processing chunk (${chunkStr.length} bytes)`,
    );

    if (
      this.sourceFormat === FORMAT_OPENAI &&
      this.targetFormat === FORMAT_OLLAMA
    ) {
      const lines = chunkStr.split("\n").filter((line) => line.trim() !== "");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.substring(6).trim();

          if (data === "[DONE]") {
            if (this.isPotentialToolCall && this.toolCallBuffer) {
              logger.debug(
                "[STREAM PROCESSOR] FC: Received [DONE] while buffering potential tool call.",
              );
              this.handleEndOfStreamWhileBufferingXML();
            }

            if (!this.isPotentialToolCall) {
              this.res.write(
                JSON.stringify({
                  model: this.model ?? "unknown-model",
                  created_at: new Date().toISOString(),
                  response: "",
                  done: true,
                }) + "\n",
              );
            }
            this.end();
            return;
          }

          try {
            const parsedChunk = JSON.parse(data) as OpenAIStreamChunk;
            if (parsedChunk.model) {this.model = parsedChunk.model;}

            const contentDelta = parsedChunk.choices[0]?.delta?.content;

            if (contentDelta) {
              // Wrappers-only: start buffering only when wrapper start appears
              if (!this.isPotentialToolCall) {
                const startIdx = contentDelta.indexOf(this.WRAPPER_START);
                if (startIdx !== -1) {
                  // Send any text before wrapper through buffer
                  const before = contentDelta.substring(0, startIdx);
                  if (before) { this.buffer += `data: ${JSON.stringify(parsedChunk)}\n\n`; }
                  this.isPotentialToolCall = true;
                  this.toolCallBuffer = contentDelta.substring(startIdx);
                  logger.debug("[STREAM PROCESSOR] FC: Detected wrapper start, buffering tool call content");
                } else {
                  this.buffer += line + "\n\n";
                }
              } else {
                // Already buffering a wrapper block
                this.toolCallBuffer += contentDelta;
              }

              if (this.isPotentialToolCall && this.toolCallBuffer.includes(this.WRAPPER_END)) {
                logger.debug("[STREAM PROCESSOR] FC: Complete wrapper detected. Attempting parse...");
                try {
                  const toolCall = extractToolCallFromWrapper(this.toolCallBuffer, this.knownToolNames);
                  if (toolCall?.name) {
                    const handled = this.handleDetectedXMLToolCallForOllama(parsedChunk as ReferenceChunk);
                    if (handled) {
                      this.resetToolCallState();
                      continue;
                    } else {
                      this.flushXMLBufferAsTextForOllama(parsedChunk as ReferenceChunk);
                    }
                  } else {
                    this.flushXMLBufferAsTextForOllama(parsedChunk as ReferenceChunk);
                  }
                } catch (xmlError: unknown) {
                  const errorMessage = xmlError instanceof Error ? xmlError.message : 'Unknown XML error';
                  logger.debug("[STREAM PROCESSOR] FC: XML parsing error:", errorMessage);
                  this.flushXMLBufferAsTextForOllama(parsedChunk as ReferenceChunk);
                }
              }
            } else {
              if (this.isPotentialToolCall && this.toolCallBuffer) {
                logger.debug("[STREAM PROCESSOR] FC: Non-content chunk while buffering. Waiting for wrapper end.");
                const handled = this.toolCallBuffer.includes(this.WRAPPER_END)
                  ? this.handleDetectedXMLToolCallForOllama(parsedChunk as ReferenceChunk)
                  : false;
                if (handled) {
                  this.resetToolCallState();
                  continue;
                } else {
                  this.flushXMLBufferAsTextForOllama(parsedChunk as ReferenceChunk);
                }
              }

              if (!this.isPotentialToolCall) {
                this.buffer += line + "\n\n";
              }
            }
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(
              "[STREAM PROCESSOR] FC: Error parsing OpenAI SSE chunk data:",
              errorMessage,
              "Data:",
              data,
            );

            this.buffer += line + "\n\n";
          }
        } else if (line.trim()) {
          logger.debug(
            "[STREAM PROCESSOR] FC: Received non-SSE line from OpenAI source:",
            line,
          );
          this.buffer += line + "\n\n";
        }
      }

      this.processBuffer();
      return;
    }

    this.buffer += chunkStr;
    this.processBuffer();
  }

  private handleDetectedXMLToolCallForOllama(referenceChunk: ReferenceChunk): boolean {
    logger.debug(
      "[STREAM PROCESSOR] FC: Attempting to handle detected tool call XML for Ollama:",
      this.toolCallBuffer,
    );
    try {
      // Wrappers-only: rely on wrapper-based extraction
      const toolCall: ExtractedToolCall | null = extractToolCallFromWrapper(
        this.toolCallBuffer,
        this.knownToolNames,
      );

      if (!toolCall?.name) {
        logger.debug(
          "[STREAM PROCESSOR] FC: Failed to parse buffered XML as tool call.",
        );
        return false;
      }

      logger.debug(
        `[STREAM PROCESSOR] FC: Successfully parsed XML tool call: ${toolCall.name}`,
      );

      // Create the Ollama tool call structure
    const ollamaToolCall: OllamaToolCallResponse = {
  model: this.model ?? referenceChunk.model ?? "unknown-model",
        created_at: new Date().toISOString(),
        response: "", // No regular response text
        done: false, // Indicate stream continues (or will be ended by a done message)
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
      };

      // Write the tool call in Ollama ndjson format
      this.res.write(JSON.stringify(ollamaToolCall) + "\n");
      logger.debug("[STREAM PROCESSOR] FC: Sent Ollama tool_call chunk.");

      // Send a follow-up 'done' message immediately to end the stream
    const doneMessage: OllamaResponse = {
  model: this.model ?? referenceChunk.model ?? "unknown-model",
        created_at: new Date().toISOString(),
        response: "",
        done: true,
      };
      this.res.write(JSON.stringify(doneMessage) + "\n");
      logger.debug("[STREAM PROCESSOR] FC: Sent Ollama done message.");

      return true; // Indicate success
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        "[STREAM PROCESSOR] FC: Error handling XML tool call for Ollama:",
        errorMessage,
      );
      return false;
    }
  }

  // Flushes the XML buffer as regular text content for Ollama client
  private flushXMLBufferAsTextForOllama(referenceChunk: ReferenceChunk): void {
    logger.debug(
      "[STREAM PROCESSOR] FC: Flushing XML tool call buffer as text for Ollama:",
      this.toolCallBuffer,
    );
    if (this.toolCallBuffer) {
      const textChunk: OllamaResponse = {
    model: this.model ?? referenceChunk.model ?? "unknown-model",
        created_at: new Date().toISOString(),
        response: this.toolCallBuffer, // Send the raw buffer content
        done: false,
      };
      this.res.write(JSON.stringify(textChunk) + "\n");
    }
    this.resetToolCallState();
  }

  // Handles end of stream when buffering XML for Ollama target
  private handleEndOfStreamWhileBufferingXML(): void {
    logger.debug(
      "[STREAM PROCESSOR] FC: Stream ended while buffering XML. Final check.",
    );

    try {
  // Try to handle the XML now that we have the complete buffer using wrappers-only parsing
      const handled = this.handleDetectedXMLToolCallForOllama({
        model: this.model ?? undefined,
      });
      if (handled) {
        logger.debug(
          "[STREAM PROCESSOR] FC: Successfully handled tool call at end of stream.",
        );
        this.resetToolCallState();
        return; // Handled
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.debug(
        "[STREAM PROCESSOR] FC: Error processing XML at end of stream:",
        errorMessage,
      );
    }

    // If validation or handling failed, flush as text
    logger.debug(
      "[STREAM PROCESSOR] FC: Failed to handle/validate XML at end of stream, flushing as text.",
    );
  this.flushXMLBufferAsTextForOllama({ model: this.model ?? undefined });
    // Send final done message after flushing text
    this.res.write(
      JSON.stringify({
  model: this.model ?? "unknown-model",
        created_at: new Date().toISOString(),
        response: "",
        done: true,
      }) + "\n",
    );
  }

  private resetToolCallState(): void {
    this.isPotentialToolCall = false;
    this.toolCallBuffer = "";
    logger.debug("[STREAM PROCESSOR] FC: Tool call state reset.");
  }

  // --- Generic Buffer Processing ---
  private processBuffer(): void {
    // Only process if not currently buffering an XML tool call for Ollama
    if (this.isPotentialToolCall && this.targetFormat === FORMAT_OLLAMA) {
      logger.debug(
        "[STREAM PROCESSOR] FC: Holding buffer processing while accumulating XML.",
      );
      return;
    }

    let boundary;
    // Determine the separator based on the SOURCE format
    const separator = this.sourceFormat === FORMAT_OPENAI ? "\n\n" : "\n";

    while ((boundary = this.buffer.indexOf(separator)) !== -1) {
      const piece = this.buffer.substring(0, boundary);
      this.buffer = this.buffer.substring(boundary + separator.length);

      if (piece.trim() === "") {continue;}

      try {
        let parsedPiece = piece;
        let sourceJson: unknown;

        // OpenAI SSE needs special handling for "data: " prefix and "[DONE]"
        if (this.sourceFormat === FORMAT_OPENAI) {
          if (piece.startsWith("data: ")) {
            parsedPiece = piece.slice(6).trim();
            if (parsedPiece === "[DONE]") {
              logger.debug(
                "[STREAM PROCESSOR] Detected [DONE] signal from OpenAI source.",
              );
              // Handle [DONE] based on target format
              if (this.targetFormat === FORMAT_OLLAMA) {
                // Send a final "done": true message for Ollama
                this.res.write(
                  JSON.stringify({
                    model: this.model ?? "unknown-model",
                    created_at: new Date().toISOString(),
                    response: "",
                    done: true,
                  }) + "\n",
                );
              } else {
                // Forward the [DONE] signal for OpenAI target
                this.res.write("data: [DONE]\n\n");
              }
              continue; // Skip further processing for [DONE]
            }
            // If it's data but not [DONE], parse JSON
            sourceJson = JSON.parse(parsedPiece);
            if (typeof sourceJson === 'object' && sourceJson !== null && 'model' in sourceJson && sourceJson.model) {
              this.model = sourceJson.model as string;
            } // Store model
          } else {
            // Ignore lines not starting with 'data: ' in OpenAI stream
            logger.debug(
              "[STREAM PROCESSOR] Ignoring non-data line from OpenAI source:",
              piece,
            );
            continue; // Skip non-data lines
          }
        } else {
          // Source is Ollama (ndjson)
          sourceJson = JSON.parse(parsedPiece);
          if (typeof sourceJson === 'object' && sourceJson !== null && 'model' in sourceJson && sourceJson.model) {
            this.model = sourceJson.model as string;
          } // Store model
          if (typeof sourceJson === 'object' && sourceJson !== null && 'done' in sourceJson && sourceJson.done === true) {
            logger.debug(
              "[STREAM PROCESSOR] Detected 'done: true' from Ollama source.",
            );
            // Handle 'done' based on target format
            if (this.targetFormat === FORMAT_OPENAI) {
              // Send [DONE] signal for OpenAI target
              this.res.write("data: [DONE]\n\n");
            } else {
              // Forward the 'done' message for Ollama target
              this.res.write(JSON.stringify(sourceJson) + "\n");
            }
            continue; // Skip further processing for done message
          }
        }

        // Convert the parsed chunk to the target format
        const convertedJson = convertResponse(
          this.sourceFormat,
          this.targetFormat,
          sourceJson as OpenAIResponse | OllamaResponse,
          true,
        ); // Indicate it's a stream chunk

        // Write the converted chunk in the target format
        if (this.targetFormat === FORMAT_OPENAI) {
          this.res.write(formatSSEChunk(convertedJson)); // Format as SSE
        } else {
          // Target is Ollama (ndjson)
          this.res.write(JSON.stringify(convertedJson) + "\n"); // Format as JSON line
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(
          `[STREAM PROCESSOR] Error processing/converting chunk (${this.sourceFormat} -> ${this.targetFormat}):`,
          errorMessage,
        );
        logger.error("[STREAM PROCESSOR] Failed Chunk Data:", piece);
        this.sendErrorToClient(`Error processing stream chunk: ${errorMessage}`);
      }
    }
  }

  end(): void {
    if (this.streamClosed) {return;}
    logger.debug(
      `[STREAM PROCESSOR] Backend stream ended (${this.sourceFormat}). Processing remaining buffer.`,
    );

    // If we were buffering XML for Ollama when the stream ended, handle it
    if (
      this.isPotentialToolCall &&
      this.toolCallBuffer &&
      this.targetFormat === FORMAT_OLLAMA
    ) {
      this.handleEndOfStreamWhileBufferingXML();
    }
    // Process any remaining non-XML data in the main buffer
    else if (this.buffer.trim()) {
      logger.debug(
        "[STREAM PROCESSOR] Processing final buffer content:",
        this.buffer,
      );
      // Add a final separator to ensure the last piece is processed
      const finalSeparator =
        this.sourceFormat === FORMAT_OPENAI ? "\n\n" : "\n";
      this.buffer += finalSeparator;
      this.processBuffer(); // Process remaining buffer content
    }

    logger.debug("[STREAM PROCESSOR] Finalizing client stream.");
    if (!this.res.writableEnded) {
      // Send final termination signal if not already sent by buffer processing
      if (
        this.targetFormat === FORMAT_OPENAI &&
        !this.buffer.includes("data: [DONE]")
      ) {
        this.res.write("data: [DONE]\n\n");
      } else if (
        this.targetFormat === FORMAT_OLLAMA &&
        !this.buffer.includes('"done":true')
      ) {
        // Ensure a final done:true is sent for Ollama if not already handled
        this.res.write(
          JSON.stringify({
            model: this.model ?? "unknown-model",
            created_at: new Date().toISOString(),
            response: "",
            done: true,
          }) + "\n",
        );
      }
      this.res.end();
    }
    this.streamClosed = true;
  }


  private sendErrorToClient(errorMessage: string): void {
    if (this.res.headersSent && !this.res.writableEnded) {
      try {
        if (this.targetFormat === FORMAT_OPENAI) {
          const errorChunk = {
            error: { message: errorMessage, code: "STREAM_ERROR" },
          };
          this.res.write(formatSSEChunk(errorChunk));
        } else {
          // Ollama target
          const errorPayload = {
            error: errorMessage,
            code: "STREAM_ERROR",
            done: true,
          }; // Mark as done on error
          this.res.write(JSON.stringify(errorPayload) + "\n");
        }
      } catch (writeError: unknown) {
        const writeErrorMessage = writeError instanceof Error ? writeError.message : 'Unknown write error';
        logger.error(
          "[STREAM PROCESSOR] Failed to write error chunk to client:",
          writeErrorMessage,
        );
      }
    } else if (!this.res.headersSent) {
      // If headers haven't been sent, we can send a proper JSON error response
      try {
        this.res.status(500).json({
          error: { message: errorMessage, code: "STREAM_INIT_ERROR" },
        });
      } catch (jsonError: unknown) {
        const jsonErrorMessage = jsonError instanceof Error ? jsonError.message : 'Unknown JSON error';
        logger.error(
          "[STREAM PROCESSOR] Failed to send JSON error response:",
          jsonErrorMessage,
        );
        // Fallback if JSON fails
        this.res.status(500).send(`Stream Error: ${errorMessage}`);
      }
      this.streamClosed = true; // Ensure stream is marked closed after sending error
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

  closeStreamWithError(errorMessage: string): void {
    this.sendErrorToClient(errorMessage);
    this.closeStream();
  }

  handleDone(): void {
    this.end();
  }
}