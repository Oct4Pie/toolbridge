import { logger } from "../../logging/index.js";
import { extractToolCallFromWrapper } from "../../parsers/xml/index.js";
import { getConverter } from "../../translation/converters/base.js";
import { createConversionContext } from "../../translation/utils/contextFactory.js";
import { formatToProvider } from "../../translation/utils/providerMapping.js";
import { formatSSEChunk } from "../../utils/http/index.js";
import { FORMAT_OLLAMA, FORMAT_OPENAI } from "../formatDetector.js";

import type { ProviderConverter } from "../../translation/converters/base.js";
import type { ConversionContext, LLMProvider } from "../../translation/types/index.js";
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

// Wrappers-only policy: no unwrapped detection

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
  private doneSent: boolean = false;
  private isPotentialToolCall: boolean = false;
  private toolCallBuffer: string = "";
  private wrapperDetectionBuffer: string = ""; // Buffer for detecting wrapper across chunks (OpenAI source)
  private ollamaResponseAccumulator: string = ""; // Accumulate Ollama response content for wrapper detection
  private toolCallAlreadySent: boolean = false; // Flag to prevent processing after tool call sent
  private knownToolNames: string[] = [];
  private model: string | null = null;
  private readonly sourceProvider: LLMProvider;
  private readonly targetProvider: LLMProvider;
  private readonly sourceConverter: ProviderConverter;
  private readonly targetConverter: ProviderConverter;
  private translationContext: ConversionContext;
  private conversionQueue: Promise<void>;
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
    this.wrapperDetectionBuffer = "";
    this.ollamaResponseAccumulator = "";
    this.toolCallAlreadySent = false;
    this.knownToolNames = [];
    this.model = null;
  this.sourceProvider = formatToProvider(sourceFormat);
  this.targetProvider = formatToProvider(targetFormat);
  this.sourceConverter = getConverter(this.sourceProvider);
  this.targetConverter = getConverter(this.targetProvider);
  this.translationContext = createConversionContext(this.sourceProvider, this.targetProvider);
  this.conversionQueue = Promise.resolve();
    
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
    this.translationContext.knownToolNames = this.knownToolNames;
    this.translationContext.enableXMLToolParsing = this.knownToolNames.length > 0;
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
              // Accumulate content for wrapper detection across chunks
              if (!this.isPotentialToolCall) {
                // Add to detection buffer
                this.wrapperDetectionBuffer += contentDelta;

                // Check if we now have the wrapper start in accumulated content
                const startIdx = this.wrapperDetectionBuffer.indexOf(this.WRAPPER_START);

                if (startIdx !== -1) {
                  // Found wrapper start!
                  // Send any text BEFORE wrapper as normal content
                  const before = this.wrapperDetectionBuffer.substring(0, startIdx);
                  if (before) {
                    const beforeChunk = {
                      ...parsedChunk,
                      choices: [{ ...parsedChunk.choices[0], delta: { content: before } }]
                    };
                    this.buffer += `data: ${JSON.stringify(beforeChunk)}\n\n`;
                  }

                  // Start buffering from wrapper start
                  this.isPotentialToolCall = true;
                  this.toolCallBuffer = this.wrapperDetectionBuffer.substring(startIdx);
                  this.wrapperDetectionBuffer = ""; // Clear detection buffer
                  logger.debug("[STREAM PROCESSOR] FC: Detected wrapper start, buffering tool call content");
                } else {
                  // No wrapper found yet
                  // Send content immediately for streaming (don't wait)
                  this.buffer += line + "\n\n";

                  // Keep only last N chars in detection buffer to prevent unbounded growth
                  // Need to keep enough to detect wrapper across chunk boundaries
                  // Wrapper is 18 chars, so keep last 20 chars to be safe
                  const maxBufferSize = 20;
                  if (this.wrapperDetectionBuffer.length > maxBufferSize) {
                    this.wrapperDetectionBuffer = this.wrapperDetectionBuffer.substring(
                      this.wrapperDetectionBuffer.length - maxBufferSize
                    );
                  }
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

  // Handles end of stream when buffering Ollama response for OpenAI target
  private handleEndOfOllamaStreamWhileBuffering(): void {
    // If we've already sent a tool call, skip end-of-stream processing
    if (this.toolCallAlreadySent) {
      logger.debug("[STREAM PROCESSOR] FC: Tool call already sent, skipping end-of-stream processing");
      return;
    }

    logger.debug(
      "[STREAM PROCESSOR] FC: Ollama stream ended while buffering for wrapper. Final check.",
    );

    try {
      const toolCall = extractToolCallFromWrapper(this.ollamaResponseAccumulator, this.knownToolNames);

      if (toolCall?.name) {
        logger.debug(`[STREAM PROCESSOR] FC: Successfully parsed Ollama tool call at end of stream: ${toolCall.name}`);

        // Create OpenAI-format tool call chunk
        const toolCallChunk = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: this.model ?? 'unknown-model',
          choices: [{
            index: 0,
            delta: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                index: 0,
                id: `call_${Date.now()}`,
                type: 'function' as const,
                function: {
                  name: toolCall.name,
                  arguments: typeof toolCall.arguments === 'string'
                    ? toolCall.arguments
                    : JSON.stringify(toolCall.arguments ?? {})
                }
              }]
            },
            finish_reason: null
          }]
        };

        // Send tool call chunk
        this.res.write(formatSSEChunk(toolCallChunk));

        // Send finish chunk
        const finishChunk = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: this.model ?? 'unknown-model',
          choices: [{
            index: 0,
            delta: {},
            finish_reason: 'tool_calls' as const
          }]
        };
        this.res.write(formatSSEChunk(finishChunk));

        this.resetToolCallState();
        return; // Handled successfully
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        "[STREAM PROCESSOR] FC: Error processing Ollama wrapper at end of stream:",
        errorMessage,
      );
    }

    // If parsing failed, send accumulated content as regular text
    logger.debug(
      "[STREAM PROCESSOR] FC: Failed to parse Ollama wrapper at end of stream, sending as text.",
    );

    if (this.ollamaResponseAccumulator) {
      const textChunk = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: this.model ?? 'unknown-model',
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            content: this.ollamaResponseAccumulator
          },
          finish_reason: null
        }]
      };
      this.res.write(formatSSEChunk(textChunk));
    }

    this.resetToolCallState();
  }

  private enqueueConversion(task: () => Promise<void>, piece: string): void {
    this.conversionQueue = this.conversionQueue
      .then(() => task())
      .catch((error) => {
        this.handleConversionError(error, piece);
      });
  }

  private async convertAndSendChunk(sourceChunk: unknown): Promise<void> {
    if (this.sourceProvider === this.targetProvider) {
      this.forwardChunkDirectly(sourceChunk);
      return;
    }

    const genericChunk = await this.sourceConverter.chunkToGeneric(sourceChunk, this.translationContext);
    if (!genericChunk) {
      return;
    }

    const convertedChunk = await this.targetConverter.chunkFromGeneric(genericChunk, this.translationContext);
    this.forwardChunkDirectly(convertedChunk);
  }

  private forwardChunkDirectly(chunk: unknown): void {
  if (this.targetFormat === FORMAT_OPENAI) {
      this.res.write(formatSSEChunk(chunk as OpenAIStreamChunk));
    } else {
      this.res.write(JSON.stringify(chunk) + "\n");
    }
  }

  private handleConversionError(error: unknown, piece: string): void {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(
      `[STREAM PROCESSOR] Error processing/converting chunk (${this.sourceFormat} -> ${this.targetFormat}):`,
      errorMessage,
    );
    logger.error("[STREAM PROCESSOR] Failed Chunk Data:", piece);
    this.sendErrorToClient(`Error processing stream chunk: ${errorMessage}`);
  }

  private resetToolCallState(): void {
    this.isPotentialToolCall = false;
    this.toolCallBuffer = "";
    this.wrapperDetectionBuffer = "";
    this.ollamaResponseAccumulator = "";
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

        // OpenAI uses SSE format with "data: " prefix and "[DONE]"
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
                // Forward the [DONE] signal for OpenAI target (only if not already sent)
                if (!this.doneSent) {
                  this.res.write("data: [DONE]\n\n");
                  this.doneSent = true;
                }
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

          // For Ollama -> OpenAI with tools: accumulate response content to detect wrappers
          logger.debug(
            `[STREAM PROCESSOR] FC: Checking accumulation conditions: source=${this.sourceFormat}, target=${this.targetFormat}, tools=${this.knownToolNames.length}`
          );

          if (
            this.sourceFormat === FORMAT_OLLAMA &&
            this.targetFormat === FORMAT_OPENAI &&
            this.knownToolNames.length > 0
          ) {
            // If we've already sent a tool call, skip all further accumulation
            if (this.toolCallAlreadySent) {
              logger.debug("[STREAM PROCESSOR] FC: Tool call already sent, skipping further accumulation");
              continue;
            }

            logger.debug("[STREAM PROCESSOR] FC: Entering Ollama->OpenAI accumulation logic");

            const ollamaChunk = sourceJson as OllamaResponse;

            // Ollama can return either native format (response field) or OpenAI-compatible format (message.content field)
            const responseContent =
              (typeof ollamaChunk.response === 'string' ? ollamaChunk.response : '') ||
              ((ollamaChunk as any).message?.content as string) || '';

            if (responseContent) {
              logger.debug(
                `[STREAM PROCESSOR] FC: Got content: "${responseContent.substring(0, 50)}..." (${responseContent.length} chars)`
              );

              logger.debug(`[STREAM PROCESSOR] FC: isPotentialToolCall=${this.isPotentialToolCall}, toolCallAlreadySent=${this.toolCallAlreadySent}`);

              // Use detection buffer pattern similar to OpenAI side
              if (!this.isPotentialToolCall) {
                // Add to detection buffer (accumulator)
                this.ollamaResponseAccumulator += responseContent;

                // Check if we now have the wrapper start
                const startIdx = this.ollamaResponseAccumulator.indexOf(this.WRAPPER_START);

                if (startIdx !== -1) {
                  // Found wrapper start!
                  logger.debug("[STREAM PROCESSOR] FC: Detected wrapper start in Ollama response");
                  this.isPotentialToolCall = true;
                  // Keep everything from wrapper start onwards
                  // Note: We don't send content before wrapper for Ollama because tool calls should be the complete response
                } else {
                  // No wrapper detected yet
                  // Use sliding window: keep last N chars, send the rest
                  const maxBufferSize = 25; // Keep enough to detect wrapper across boundaries (<toolbridge:calls> = 18 chars)

                  if (this.ollamaResponseAccumulator.length > maxBufferSize) {
                    logger.debug(`[STREAM PROCESSOR] FC: No wrapper in first ${maxBufferSize} chars, treating as normal text`);
                    // This is normal text, not a tool call.
                    // We need to send the accumulated content (minus the sliding window) as a chunk
                    const contentToSend = this.ollamaResponseAccumulator.substring(
                      0,
                      this.ollamaResponseAccumulator.length - maxBufferSize
                    );

                    if (contentToSend) {
                      // Create an OpenAI-format chunk with the accumulated content
                      const textChunk = {
                        id: `chatcmpl-${Date.now()}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: this.model ?? 'unknown-model',
                        choices: [{
                          index: 0,
                          delta: {
                            role: 'assistant',
                            content: contentToSend
                          },
                          finish_reason: null
                        }]
                      };
                      this.res.write(formatSSEChunk(textChunk));
                    }

                    // Keep last N chars for continued wrapper detection
                    this.ollamaResponseAccumulator = this.ollamaResponseAccumulator.substring(
                      this.ollamaResponseAccumulator.length - maxBufferSize
                    );
                    // Skip normal chunk processing since we already sent the accumulated content
                    continue;
                  } else {
                    // Still within buffer size, keep accumulating and skip this chunk
                    logger.debug("[STREAM PROCESSOR] FC: Buffering Ollama content for wrapper detection");
                    continue;
                  }
                }
              } else {
                // Already detected wrapper start, keep accumulating
                this.ollamaResponseAccumulator += responseContent;
              }

              // Check for wrapper end (complete wrapper)
              if (this.isPotentialToolCall && this.ollamaResponseAccumulator.includes(this.WRAPPER_END)) {
                logger.debug("[STREAM PROCESSOR] FC: Complete wrapper detected in Ollama response. Attempting parse...");

                try {
                  const toolCall = extractToolCallFromWrapper(this.ollamaResponseAccumulator, this.knownToolNames);

                  if (toolCall?.name) {
                    logger.debug(`[STREAM PROCESSOR] FC: Successfully parsed Ollama XML tool call: ${toolCall.name}`);

                    // Create OpenAI-format tool call chunk
                    const toolCallChunk = {
                      id: `chatcmpl-${Date.now()}`,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: this.model ?? 'unknown-model',
                      choices: [{
                        index: 0,
                        delta: {
                          role: 'assistant',
                          content: null,
                          tool_calls: [{
                            index: 0,
                            id: `call_${Date.now()}`,
                            type: 'function' as const,
                            function: {
                              name: toolCall.name,
                              arguments: typeof toolCall.arguments === 'string'
                                ? toolCall.arguments
                                : JSON.stringify(toolCall.arguments ?? {})
                            }
                          }]
                        },
                        finish_reason: null
                      }]
                    };

                    // Send tool call chunk
                    this.res.write(formatSSEChunk(toolCallChunk));

                    // Send finish chunk
                    const finishChunk = {
                      id: `chatcmpl-${Date.now()}`,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: this.model ?? 'unknown-model',
                      choices: [{
                        index: 0,
                        delta: {},
                        finish_reason: 'tool_calls' as const
                      }]
                    };
                    this.res.write(formatSSEChunk(finishChunk));

                    // Send [DONE]
                    if (!this.doneSent) {
                      this.res.write("data: [DONE]\n\n");
                      this.doneSent = true;
                    }

                    // Mark that we've sent a tool call - stop processing further chunks
                    this.toolCallAlreadySent = true;
                    this.resetToolCallState();

                    // Don't call res.end() here! The writes are async and need to flush.
                    // The backend stream will end naturally and trigger our end() method.
                    logger.debug("[STREAM PROCESSOR] FC: Tool call sent, skipping remaining chunks");
                    continue; // Skip this chunk and continue (will skip all future chunks due to toolCallAlreadySent flag)
                  } else {
                    logger.debug("[STREAM PROCESSOR] FC: Failed to parse Ollama XML, flushing as normal content");
                    // Fall through to normal processing
                    this.resetToolCallState();
                  }
                } catch (error) {
                  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                  logger.error("[STREAM PROCESSOR] FC: Error parsing Ollama XML tool call:", errorMessage);
                  this.resetToolCallState();
                  // Fall through to normal processing
                }
              }

              // If still buffering, skip normal chunk sending
              if (this.isPotentialToolCall) {
                logger.debug("[STREAM PROCESSOR] FC: Still buffering Ollama wrapper, skipping chunk send");
                continue;
              }
            }
          }

          // Check if this is a done message
          const isDone = typeof sourceJson === 'object' && sourceJson !== null && 'done' in sourceJson && sourceJson.done === true;

          // Log full accumulated content at end for debugging
          if (isDone && this.ollamaResponseAccumulator) {
            logger.debug(`[STREAM PROCESSOR] FC: Final accumulated content:\n${this.ollamaResponseAccumulator}`);
          }

          if (isDone) {
            logger.debug(
              "[STREAM PROCESSOR] Detected 'done: true' from Ollama source.",
            );

            // For OpenAI target, convert the final chunk (which will have finish_reason: "stop")
            // then send [DONE] after conversion completes
            if (this.targetFormat === FORMAT_OPENAI) {
              const chunkPayload = sourceJson as OpenAIResponse | OllamaResponse;
              // Convert and send the final chunk with finish_reason
              this.enqueueConversion(async () => {
                await this.convertAndSendChunk(chunkPayload);
                // Then send [DONE] signal after the chunk is sent
                if (!this.doneSent) {
                  this.res.write("data: [DONE]\n\n");
                  this.doneSent = true;
                }
              }, piece);
              continue;
            } else {
              // Forward the 'done' message for Ollama target
              this.res.write(JSON.stringify(sourceJson) + "\n");
              continue;
            }
          }
        }

        const chunkPayload = sourceJson as OpenAIResponse | OllamaResponse;
        this.enqueueConversion(() => this.convertAndSendChunk(chunkPayload), piece);
      } catch (error: unknown) {
        this.handleConversionError(error, piece);
      }
    }
  }

  end(): void {
    if (this.streamClosed) {return;}
    logger.debug(
      `[STREAM PROCESSOR] Backend stream ended (${this.sourceFormat}). Processing remaining buffer.`,
    );

    // If we were buffering XML for Ollama target when the stream ended, handle it
    if (
      this.isPotentialToolCall &&
      this.toolCallBuffer &&
      this.targetFormat === FORMAT_OLLAMA
    ) {
      this.handleEndOfStreamWhileBufferingXML();
    }
    // If we were buffering Ollama response for OpenAI target, try to parse final wrapper
    else if (
      this.isPotentialToolCall &&
      this.ollamaResponseAccumulator &&
      this.sourceFormat === FORMAT_OLLAMA &&
      this.targetFormat === FORMAT_OPENAI
    ) {
      this.handleEndOfOllamaStreamWhileBuffering();
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
      // Send final termination signal if not already sent
      if (this.targetFormat === FORMAT_OPENAI && !this.doneSent) {
        this.res.write("data: [DONE]\n\n");
        this.doneSent = true;
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

      // Use setImmediate to allow pending writes to flush before calling end()
      // This is critical when toolCallAlreadySent=true and we've just written tool call chunks
      setImmediate(() => {
        if (!this.res.writableEnded) {
          this.res.end();
        }
      });
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