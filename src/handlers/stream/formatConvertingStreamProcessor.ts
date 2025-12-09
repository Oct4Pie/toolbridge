import { config } from "../../config.js";
import { logger } from "../../logging/index.js";
import { attemptPartialToolCallExtraction, extractToolCallUnified } from "../../parsers/xml/index.js";
import { OpenAIConverter } from "../../translation/converters/openai-simple.js";
import { translateChunk } from "../../translation/index.js";
import { createConversionContext } from "../../translation/utils/contextFactory.js";
import { extractToolNames } from "../../translation/utils/formatUtils.js";
import { formatToProvider } from "../../translation/utils/providerMapping.js";
import {
  extractErrorMessage,
  handleStreamingBackendError,
} from "../../utils/http/errorResponseHandler.js";
import { formatSSEChunk } from "../../utils/http/index.js";
import { FORMAT_OLLAMA, FORMAT_OPENAI } from "../formatDetector.js";

import { BufferManager } from "./components/BufferManager.js";
import { NdjsonFormatter } from "./components/NdjsonFormatter.js";

import type { ConversionContext, LLMProvider } from "../../translation/types/index.js";
import type {
  RequestFormat,
  OpenAITool,
  StreamProcessor,
  ExtractedToolCall,
  OpenAIStreamChunk,
  OpenAIResponse,
  OllamaStreamChunkFields,
  PartialToolCallState,
} from "../../types/index.js";
import type { Response } from "express";

/**
 * FormatConvertingStreamProcessor
 *
 * SSOT Compliance: This processor maintains Single Source of Truth by routing
 * all chunk conversions through the TranslationEngine's public API (translateChunk).
 *
 * Architecture:
 * - Uses translateChunk() from translation layer instead of direct converter access
 * - The translation engine handles: source → generic → target conversion
 * - All conversion logic, error handling, and context management centralized
 * - No direct converter instantiation or method calls
 *
 * This approach ensures:
 * 1. All format conversions route through the translation layer (SSOT Principle #1)
 * 2. Clean separation between HTTP streaming and translation concerns (Principle #2)
 * 3. No duplication of conversion logic (DRY Principle #3)
 * 4. Explicit contract with TranslationEngine (Principle #4)
 *
 * Historical Context:
 * Previously violated SSOT by directly calling converter.chunkToGeneric() and
 * converter.chunkFromGeneric(). Now properly delegates to translation engine.
 */

// Wrappers-only policy: no unwrapped detection

interface ReferenceChunk {
  model?: string | undefined;
  [key: string]: unknown;
}

type OllamaToolCallResponse = OllamaStreamChunkFields & {
  tool_calls: Array<{
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
  response?: string;
};

export class FormatConvertingStreamProcessor implements StreamProcessor {
  public res: Response;
  private readonly sourceFormat: RequestFormat;
  private readonly targetFormat: RequestFormat;
  private readonly targetStreamMode: 'ndjson' | 'sse';
  // SSOT: Use BufferManager components for all buffering
  private readonly mainBuffer: BufferManager;
  private readonly toolCallBuffer: BufferManager;
  private readonly unifiedDetectionBuffer: BufferManager; // Ollama→OpenAI XML accumulation
  private readonly unifiedDetectionBufferOpenAI: BufferManager; // OpenAI→Ollama XML accumulation
  private streamClosed: boolean = false;
  private doneSent: boolean = false;
  private isPotentialToolCall: boolean = false;
  private toolCallAlreadySent: boolean = false; // Flag to prevent processing after tool call sent
  private knownToolNames: string[] = [];
  private model: string | null = null;
  private readonly sourceProvider: LLMProvider;
  private readonly targetProvider: LLMProvider;
  private translationContext: ConversionContext;
  private conversionQueue: Promise<void>;
  // Unified partial XML detection state (SSOT)
  private partialToolCallState: PartialToolCallState | null = null;
  // SSOT state for OpenAI→Ollama path
  private partialToolCallStateOpenAI: PartialToolCallState | null = null;
  // SSOT: Use reusable components
  private readonly openaiConverter: OpenAIConverter = new OpenAIConverter();
  private readonly ndjsonFormatter: NdjsonFormatter = new NdjsonFormatter();

  constructor(
    res: Response,
    sourceFormat: RequestFormat,
    targetFormat: RequestFormat,
    options?: {
      targetStreamMode?: 'ndjson' | 'sse';
    }
  ) {
    this.res = res;
    this.sourceFormat = sourceFormat;
    this.targetFormat = targetFormat;
    this.targetStreamMode = options?.targetStreamMode
      ?? (targetFormat === FORMAT_OPENAI ? 'sse' : 'ndjson');
    // Initialize BufferManager instances (SSOT for buffering)
    this.mainBuffer = new BufferManager(
      config.performance.maxStreamBufferSize,
      "MainStreamBuffer"
    );
    this.toolCallBuffer = new BufferManager(
      config.performance.maxToolCallBufferSize,
      "ToolCallBuffer"
    );
    this.unifiedDetectionBuffer = new BufferManager(
      config.performance.maxToolCallBufferSize,
      "UnifiedDetectionBuffer"
    );
    this.unifiedDetectionBufferOpenAI = new BufferManager(
      config.performance.maxToolCallBufferSize,
      "UnifiedDetectionBufferOpenAI"
    );
    this.streamClosed = false;
    this.isPotentialToolCall = false;
    this.toolCallAlreadySent = false;
    this.knownToolNames = [];
    this.model = null;
    this.sourceProvider = formatToProvider(sourceFormat);
    this.targetProvider = formatToProvider(targetFormat);
    this.translationContext = createConversionContext(this.sourceProvider, this.targetProvider);
    this.conversionQueue = Promise.resolve();
    this.partialToolCallState = null;
    this.partialToolCallStateOpenAI = null;

    logger.debug(
      `[STREAM PROCESSOR] Initialized FormatConvertingStreamProcessor (${sourceFormat} -> ${targetFormat})`,
    );

    const contentType = this.targetStreamMode === 'sse'
      ? "text/event-stream"
      : "application/x-ndjson";
    this.res.setHeader("Content-Type", contentType);
    this.res.setHeader("Cache-Control", "no-cache");
    this.res.setHeader("Connection", "keep-alive");
  }

  private writeChunkString(payload: string): void {
    if (this.targetStreamMode === 'sse') {
      const trimmed = payload.trim();
      this.res.write(`data: ${trimmed}\n\n`);
      return;
    }

    if (payload.endsWith("\n")) {
      this.res.write(payload);
    } else {
      this.res.write(`${payload}\n`);
    }
  }

  private writeOllamaChunk(chunk: unknown): void {
    this.writeChunkString(JSON.stringify(chunk));
  }

  private writeOllamaFormattedChunk(formatted: string): void {
    this.writeChunkString(formatted);
  }

  private writeOllamaDone(data?: Record<string, unknown>): void {
    const donePayload = {
      ...(data ?? {}),
      done: true,
    };

    if (this.targetStreamMode === 'sse') {
      this.writeChunkString(JSON.stringify(donePayload));
      this.res.write("data: [DONE]\n\n");
    } else {
      this.res.write(this.ndjsonFormatter.formatDone(data ?? {}));
    }

    this.doneSent = true;
  }
  setTools(tools?: OpenAITool[]): void {
    // Use formatUtils SSOT for tool name extraction
    this.knownToolNames = extractToolNames(tools ?? []);
    logger.debug(
      "[STREAM PROCESSOR] FormatConverter known tool names set:",
      this.knownToolNames,
    );
    this.translationContext.knownToolNames = this.knownToolNames;
    this.translationContext.enableXMLToolParsing = this.knownToolNames.length > 0;
  }

  processChunk(chunk: Buffer | string): void {
    if (this.streamClosed) { return; }

    const chunkStr = chunk.toString();
    logger.info(`[FC DEBUG] processChunk: source=${this.sourceFormat}, target=${this.targetFormat}, chunk="${chunkStr.substring(0, 100)}"`);
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
              // handleEndOfStreamWhileBufferingXML() sends done: true, so return early
              // to avoid sending done: true again below
              this.end();
              return;
            }

            // Only reached if we weren't buffering a tool call
            logger.info("[FC DEBUG] processChunk writing NDJSON done for Ollama (OpenAI->Ollama)");
            const donePayload = {
              model: this.model ?? "unknown-model",
              created_at: new Date().toISOString(),
              response: "",
            } as Record<string, unknown>;
            logger.info("[FC DEBUG] Done signal:", JSON.stringify({ ...donePayload, done: true }));
            this.writeOllamaDone(donePayload);
            logger.info("[FC DEBUG] Calling this.end()");
            this.end();
            return;
          }

          try {
            const parsedChunk = JSON.parse(data) as OpenAIStreamChunk;
            if (parsedChunk.model) { this.model = parsedChunk.model; }

            const contentDelta = parsedChunk.choices[0]?.delta?.content;

            if (contentDelta) {
              // SSOT: use unified partial extraction for OpenAI→Ollama with BufferManager
              this.unifiedDetectionBufferOpenAI.append(contentDelta);
              const extraction = attemptPartialToolCallExtraction(
                this.unifiedDetectionBufferOpenAI.getContent(),
                this.knownToolNames,
                this.partialToolCallStateOpenAI
              );

              if (extraction.complete && extraction.toolCall) {
                const xmlContent = extraction.content ?? "";
                const bufferContent = this.unifiedDetectionBufferOpenAI.getContent();
                const idx = bufferContent.indexOf(xmlContent);
                const before = idx > 0 ? bufferContent.substring(0, idx) : "";
                if (before) {
                  const beforeChunk = {
                    ...parsedChunk,
                    choices: [{ ...parsedChunk.choices[0], delta: { content: before } }]
                  };
                  this.mainBuffer.append(`data: ${JSON.stringify(beforeChunk)}\n\n`);
                }

                // Reuse existing Ollama handler by setting toolCallBuffer for wrapper-based extraction
                this.toolCallBuffer.setContent(xmlContent);
                const handled = this.handleDetectedXMLToolCallForOllama(parsedChunk as ReferenceChunk);
                if (handled) {
                  const endPos = idx + xmlContent.length;
                  const remainder = endPos < bufferContent.length
                    ? bufferContent.substring(endPos)
                    : "";
                  this.unifiedDetectionBufferOpenAI.setContent(remainder);
                  this.partialToolCallStateOpenAI = null;
                  this.resetToolCallState();
                  continue;
                }
              }

              this.partialToolCallStateOpenAI = extraction.partialState ?? null;
              if (!this.partialToolCallStateOpenAI?.mightBeToolCall) {
                // No tool call likely, forward original line for conversion
                this.mainBuffer.append(line + "\n\n");
                this.unifiedDetectionBufferOpenAI.clear();
              } else {
                // Keep buffering - BufferManager already enforces size cap via maxSize
                // No manual trimming needed
              }
            } else {
              // Non-content delta; forward unless buffering a potential tool call
              if (!this.partialToolCallStateOpenAI?.mightBeToolCall) {
                this.mainBuffer.append(line + "\n\n");
              } else {
                logger.debug("[STREAM PROCESSOR] FC: Holding non-content chunk during potential tool call buffering (OpenAI→Ollama)");
              }
            }
          } catch (error: unknown) {
            const errorMessage = extractErrorMessage(error);
            logger.error(
              "[STREAM PROCESSOR] FC: Error parsing OpenAI SSE chunk data:",
              errorMessage,
              "Data:",
              data,
            );

            this.mainBuffer.append(line + "\n\n");
          }
        } else if (line.trim()) {
          logger.debug(
            "[STREAM PROCESSOR] FC: Received non-SSE line from OpenAI source:",
            line,
          );
          this.mainBuffer.append(line + "\n\n");
        }
      }

      this.processBuffer();
      return;
    }

    this.mainBuffer.append(chunkStr);
    this.processBuffer();
  }

  private handleDetectedXMLToolCallForOllama(referenceChunk: ReferenceChunk): boolean {
    const bufferContent = this.toolCallBuffer.getContent();
    logger.debug(
      "[STREAM PROCESSOR] FC: Attempting to handle detected tool call XML for Ollama:",
      bufferContent,
    );
    try {
      // SSOT: Use unified extraction (tries wrapper first, then direct extraction)
      // This handles both models that follow instructions (use wrapper) and those that don't
      const toolCall: ExtractedToolCall | null = extractToolCallUnified(
        bufferContent,
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

      // Write the tool call in Ollama format (NDJSON or SSE wrapper)
      this.writeOllamaChunk(ollamaToolCall);
      logger.debug("[STREAM PROCESSOR] FC: Sent Ollama tool_call chunk.");

      // CRITICAL FIX: Don't send done message here! Let backend's done signal propagate naturally.
      // Sending done immediately causes client to think stream is complete,
      // but we need to wait for backend's natural done signal to properly close the stream.
      // This was causing clients to loop because stream never properly completed.

      // Mark that tool call was sent
      this.toolCallAlreadySent = true;

      return true; // Indicate success
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      logger.error(
        "[STREAM PROCESSOR] FC: Error handling XML tool call for Ollama:",
        errorMessage,
      );
      return false;
    }
  }

  // Flushes the XML buffer as regular text content for Ollama client
  private flushXMLBufferAsTextForOllama(referenceChunk: ReferenceChunk): void {
    const bufferContent = this.toolCallBuffer.getContent();
    logger.debug(
      "[STREAM PROCESSOR] FC: Flushing XML tool call buffer as text for Ollama:",
      bufferContent,
    );
    if (bufferContent) {
      // Use NdjsonFormatter for consistent NDJSON formatting (SSOT)
      const formatted = this.ndjsonFormatter.formatResponse(
        bufferContent,
        this.model ?? referenceChunk.model ?? "unknown-model",
        false
      );
      this.writeOllamaFormattedChunk(formatted);
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
      const errorMessage = extractErrorMessage(error);
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


  private enqueueConversion(task: () => Promise<void>, piece: string): void {
    this.conversionQueue = this.conversionQueue
      .then(() => task())
      .catch((error) => {
        this.handleConversionError(error, piece);
      });
  }

  /**
   * Convert and send a chunk using the translation engine's public API.
   *
   * SSOT-Compliant: Uses translateChunk() from the translation layer instead of
   * directly accessing converters. This ensures all conversion logic stays in one place.
   *
   * @param sourceChunk - The chunk in the source provider's format
   */
  private async convertAndSendChunk(sourceChunk: unknown): Promise<void> {
    // Use the translation engine's public API (translateChunk) to convert the chunk.
    // This maintains SSOT by routing all conversions through the translation layer.
    // The translation engine handles: source → generic → target internally.
    const convertedChunk = await translateChunk(
      sourceChunk,
      this.sourceProvider,
      this.targetProvider,
      this.translationContext
    );

    // translateChunk returns null if the chunk should be skipped (e.g., empty/invalid)
    if (convertedChunk === null) {
      return;
    }

    this.forwardChunkDirectly(convertedChunk);
  }

  private forwardChunkDirectly(chunk: unknown): void {
    if (this.targetFormat === FORMAT_OPENAI) {
      this.res.write(formatSSEChunk(chunk as OpenAIStreamChunk));
    } else {
      this.writeOllamaChunk(chunk);
    }
  }

  private handleConversionError(error: unknown, piece: string): void {
    const errorMessage = extractErrorMessage(error);
    logger.error(
      `[STREAM PROCESSOR] Error processing/converting chunk (${this.sourceFormat} -> ${this.targetFormat}):`,
      errorMessage,
    );
    logger.error("[STREAM PROCESSOR] Failed Chunk Data:", piece);
    this.sendErrorToClient(`Error processing stream chunk: ${errorMessage}`);
  }

  private resetToolCallState(): void {
    this.isPotentialToolCall = false;
    this.toolCallBuffer.clear();
    logger.debug("[STREAM PROCESSOR] FC: Tool call state reset.");
  }

  private chunkHasNativeToolCalls(chunk: unknown): boolean {
    if (chunk === null || typeof chunk !== 'object') {
      return false;
    }

    const record = chunk as Record<string, unknown>;
    const directToolCalls = record['tool_calls'];
    if (Array.isArray(directToolCalls) && directToolCalls.length > 0) {
      return true;
    }

    const messageValue = record['message'];
    if (messageValue && typeof messageValue === 'object') {
      const messageRecord = messageValue as Record<string, unknown>;
      const messageToolCalls = messageRecord['tool_calls'];
      if (Array.isArray(messageToolCalls) && messageToolCalls.length > 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * Flush pending text content from unified buffer to OpenAI stream
   */
  private flushPendingTextToOpenAI(): void {
    if (!this.unifiedDetectionBuffer.hasContent()) {
      return;
    }
    const textChunk = this.openaiConverter.createStreamChunk(
      null,
      this.model ?? 'unknown-model',
      this.unifiedDetectionBuffer.getContent(),
      null
    );
    this.res.write(formatSSEChunk(textChunk));
    this.unifiedDetectionBuffer.clear();
  }

  /**
   * Handle detected complete tool call for Ollama → OpenAI conversion
   * Flushes preface text, sends tool call sequence, updates state
   */
  private sendCompleteToolCallToOpenAI(extraction: { complete: boolean; toolCall?: any; content?: string }): void {
    if (!extraction.complete || !extraction.toolCall) {
      return;
    }

    const xmlContent = extraction.content ?? "";
    const detectionBufferContent = this.unifiedDetectionBuffer.getContent();
    const idx = detectionBufferContent.indexOf(xmlContent);

    // Flush any preface text before the wrapper
    const preface = idx > 0 ? detectionBufferContent.substring(0, idx) : "";
    if (preface) {
      const textChunk = this.openaiConverter.createStreamChunk(
        null,
        this.model ?? 'unknown-model',
        preface,
        null
      );
      this.res.write(formatSSEChunk(textChunk));
    }

    const seq = this.openaiConverter.createToolCallStreamSequence(
      {
        name: extraction.toolCall.name,
        arguments: typeof extraction.toolCall.arguments === 'string'
          ? extraction.toolCall.arguments
          : (extraction.toolCall.arguments ?? {}),
      },
      null,
      this.model ?? 'unknown-model'
    );
    for (const c of seq) {
      this.res.write(formatSSEChunk(c));
    }

    // Update state: mark sent, reset buffers, but keep any trailing remainder
    this.toolCallAlreadySent = true;
    const endPos = idx + xmlContent.length;
    const remainder = endPos < detectionBufferContent.length
      ? detectionBufferContent.substring(endPos)
      : "";
    this.unifiedDetectionBuffer.setContent(remainder);
    this.partialToolCallState = null;
    this.isPotentialToolCall = false;
  }

  /**
   * Handle tool call detection and processing for Ollama → OpenAI conversion
   * Accumulates response content and detects XML tool call wrappers
   * @returns true if processing should continue to next chunk, false if chunk should be enqueued for conversion
   */
  private handleOllamaToOpenAIToolCalls(ollamaChunk: OllamaStreamChunkFields): boolean {
    if (this.chunkHasNativeToolCalls(ollamaChunk)) {
      logger.debug("[STREAM PROCESSOR] FC: Detected native Ollama tool_calls; routing through translation layer");
      this.flushPendingTextToOpenAI();
      this.resetToolCallState();
      this.toolCallAlreadySent = true;
      return false; // Don't continue, let chunk be processed normally
    }

    if (this.toolCallAlreadySent) {
      logger.debug("[STREAM PROCESSOR] FC: Tool call already sent, bypassing further accumulation");
      return false; // Don't continue, let chunk be processed normally
    }

    // Extract response content
    // Handle standard Ollama 'response' (legacy), 'message.content' (chat), AND OpenAI-like 'choices' (compat)
    // Also include 'thinking' field from qwen3 models if present
    const responseContent =
      (typeof ollamaChunk.response === 'string' ? ollamaChunk.response : '') ||
      ((typeof ollamaChunk.message?.content === 'string' ? ollamaChunk.message.content : '') +
        (typeof ollamaChunk.message?.thinking === 'string' ? ollamaChunk.message.thinking : '')) ||
      (ollamaChunk.choices?.[0]?.delta?.content ?? '') ||
      '';

    if (!responseContent) {
      return false; // No content to process
    }

    logger.debug(`[STREAM PROCESSOR] FC: Got content: "${responseContent.substring(0, 50)}..." (${responseContent.length} chars)`);

    // Accumulate to unified buffer and run SSOT parser
    this.unifiedDetectionBuffer.append(responseContent);

    const extraction = attemptPartialToolCallExtraction(
      this.unifiedDetectionBuffer.getContent(),
      this.knownToolNames,
      this.partialToolCallState ?? null
    );

    if (extraction.complete && extraction.toolCall) {
      this.sendCompleteToolCallToOpenAI(extraction);
      return true; // Continue to next chunk
    }

    // Not complete; update partial state and decide flushing
    this.partialToolCallState = extraction.partialState ?? null;

    if (this.partialToolCallState?.mightBeToolCall) {
      // Keep buffering - BufferManager already enforces size cap
      logger.debug("[STREAM PROCESSOR] FC: Buffering for potential tool call (SSOT)");
      return true; // Continue to next chunk (skip enqueueing)
    }

    // No potential tool call; flush as normal text and clear buffer
    this.flushPendingTextToOpenAI();

    return true; // We flushed the buffer (which includes this chunk), so it's handled
  }

  /**
   * Handle done signal when there's pending buffer content for OpenAI target
   * Attempts final tool call extraction before sending done signal
   */
  private handleDoneSignalWithPendingBuffer(): void {
    if (this.targetFormat !== FORMAT_OPENAI || !this.unifiedDetectionBuffer.hasContent()) {
      return;
    }

    try {
      const finalExtraction = attemptPartialToolCallExtraction(
        this.unifiedDetectionBuffer.getContent(),
        this.knownToolNames,
        this.partialToolCallState ?? null
      );

      if (finalExtraction.complete && finalExtraction.toolCall) {
        const xmlContent = finalExtraction.content ?? "";
        const detectionContent = this.unifiedDetectionBuffer.getContent();
        const idx = detectionContent.indexOf(xmlContent);
        const preface = idx > 0 ? detectionContent.substring(0, idx) : "";
        if (preface) {
          const textChunk = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: this.model ?? 'unknown-model',
            choices: [{ index: 0, delta: { role: 'assistant', content: preface }, finish_reason: null }]
          };
          this.res.write(formatSSEChunk(textChunk));
        }

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
                  name: finalExtraction.toolCall.name,
                  arguments: typeof finalExtraction.toolCall.arguments === 'string'
                    ? finalExtraction.toolCall.arguments
                    : JSON.stringify(finalExtraction.toolCall.arguments ?? {})
                }
              }]
            },
            finish_reason: null
          }]
        };
        this.res.write(formatSSEChunk(toolCallChunk));

        const finishChunk = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: this.model ?? 'unknown-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' as const }]
        };
        this.res.write(formatSSEChunk(finishChunk));

        this.toolCallAlreadySent = true;
      } else if (this.unifiedDetectionBuffer.hasContent()) {
        const textChunk = this.openaiConverter.createStreamChunk(
          null,
          this.model ?? 'unknown-model',
          this.unifiedDetectionBuffer.getContent(),
          null
        );
        this.res.write(formatSSEChunk(textChunk));
      }
    } finally {
      this.unifiedDetectionBuffer.clear();
      this.partialToolCallState = null;
    }
  }

  /**
   * Process a piece from OpenAI source (SSE format)
   * Handles "data: " prefix, [DONE] signals, and JSON parsing
   * @returns parsed JSON or null if piece should be skipped
   */
  private processOpenAISourcePiece(piece: string): unknown | null {
    if (!piece.startsWith("data: ")) {
      // Ignore lines not starting with 'data: ' in OpenAI stream
      logger.debug(
        "[STREAM PROCESSOR] Ignoring non-data line from OpenAI source:",
        piece,
      );
      return null;
    }

    const parsedPiece = piece.slice(6).trim();

    if (parsedPiece === "[DONE]") {
      logger.debug(
        "[STREAM PROCESSOR] Detected [DONE] signal from OpenAI source.",
      );


      this.doneSent = true;
      return null; // Skip further processing for [DONE]
    }

    // Parse JSON and store model
    const sourceJson = JSON.parse(parsedPiece);
    if (typeof sourceJson === 'object' && sourceJson !== null && 'model' in sourceJson && sourceJson.model) {
      this.model = sourceJson.model as string;
    }
    return sourceJson;
  }

  /**
   * Process a piece from Ollama source (NDJSON format)
   * Handles tool call detection, done signals, and normal chunks
   * @returns object with shouldContinue flag and optional sourceJson for further processing
   */
  private processOllamaSourcePiece(piece: string): { shouldContinue: boolean; sourceJson?: unknown } {
    const sourceJson = JSON.parse(piece);
    if (typeof sourceJson === 'object' && sourceJson !== null && 'model' in sourceJson && sourceJson.model) {
      this.model = sourceJson.model as string;
    }

    // For Ollama -> OpenAI with tools: accumulate response content to detect wrappers
    logger.debug(
      `[STREAM PROCESSOR] FC: Checking accumulation conditions: source=${this.sourceFormat}, target=${this.targetFormat}, tools=${this.knownToolNames.length}`
    );

    if (
      this.sourceFormat === FORMAT_OLLAMA &&
      this.targetFormat === FORMAT_OPENAI &&
      this.knownToolNames.length > 0
    ) {
      const ollamaChunk = sourceJson as OllamaStreamChunkFields;
      const shouldContinue = this.handleOllamaToOpenAIToolCalls(ollamaChunk);
      if (shouldContinue) {
        return { shouldContinue: true };
      }
    }

    // Check if this is a done message
    const isDone = typeof sourceJson === 'object' && sourceJson !== null && 'done' in sourceJson && sourceJson.done === true;

    if (isDone) {
      logger.debug(
        "[STREAM PROCESSOR] Detected 'done: true' from Ollama source.",
      );

      // CRITICAL FIX: Always process backend's done signal, even if we sent a tool call
      // This ensures proper stream completion and prevents client loops
      // Before closing, flush any pending unified SSOT buffer
      this.handleDoneSignalWithPendingBuffer();

      // For OpenAI target, convert the final chunk (which will have finish_reason: "stop" or "tool_calls")
      // then send [DONE] after conversion completes
      if (this.targetFormat === FORMAT_OPENAI) {
        const chunkPayload = sourceJson as OpenAIResponse | OllamaStreamChunkFields;
        // Convert and send the final chunk with finish_reason
        this.enqueueConversion(async () => {
          await this.convertAndSendChunk(chunkPayload);
          // Then send [DONE] signal after the chunk is sent
          if (!this.doneSent) {
            this.res.write("data: [DONE]\n\n");
            this.doneSent = true;
            logger.debug("[STREAM PROCESSOR] FC: Sent [DONE] after backend done signal");
          }
        }, piece);
        return { shouldContinue: true };
      } else {
        // Forward the 'done' message for Ollama target
        this.writeOllamaChunk(sourceJson);
        logger.debug("[STREAM PROCESSOR] FC: Forwarded backend done signal to Ollama client");
        return { shouldContinue: true };
      }
    }

    return { shouldContinue: false, sourceJson };
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
    let bufferContent = this.mainBuffer.getContent();

    while ((boundary = bufferContent.indexOf(separator)) !== -1) {
      const piece = bufferContent.substring(0, boundary);
      bufferContent = bufferContent.substring(boundary + separator.length);
      this.mainBuffer.setContent(bufferContent);

      if (piece.trim() === "") { continue; }

      try {
        let sourceJson: unknown;

        // Delegate to format-specific processing
        if (this.sourceFormat === FORMAT_OPENAI) {
          sourceJson = this.processOpenAISourcePiece(piece);
          if (sourceJson === null) {
            continue; // Skip this piece
          }
        } else {
          // Source is Ollama (ndjson)
          const result = this.processOllamaSourcePiece(piece);
          if (result.shouldContinue) {
            continue; // Skip to next piece
          }
          sourceJson = result.sourceJson;
        }

        const chunkPayload = sourceJson as OpenAIResponse | OllamaStreamChunkFields;
        this.enqueueConversion(() => this.convertAndSendChunk(chunkPayload), piece);
      } catch (error: unknown) {
        this.handleConversionError(error, piece);
      }
    }
  }

  end(): void {
    if (this.streamClosed) { return; }
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
      this.sourceFormat === FORMAT_OLLAMA &&
      this.targetFormat === FORMAT_OPENAI &&
      this.unifiedDetectionBuffer.hasContent()
    ) {
      // Finalize any pending unified buffer using SSOT parser
      try {
        const finalExtraction = attemptPartialToolCallExtraction(
          this.unifiedDetectionBuffer.getContent(),
          this.knownToolNames,
          this.partialToolCallState ?? null
        );

        if (finalExtraction.complete && finalExtraction.toolCall) {
          const xmlContent = finalExtraction.content ?? "";
          const detectionContent = this.unifiedDetectionBuffer.getContent();
          const idx = detectionContent.indexOf(xmlContent);
          const preface = idx > 0 ? detectionContent.substring(0, idx) : "";
          if (preface) {
            const textChunk = this.openaiConverter.createStreamChunk(
              null,
              this.model ?? 'unknown-model',
              preface,
              null
            );
            this.res.write(formatSSEChunk(textChunk));
          }
          const seq = this.openaiConverter.createToolCallStreamSequence(
            {
              name: finalExtraction.toolCall.name,
              arguments: typeof finalExtraction.toolCall.arguments === 'string'
                ? finalExtraction.toolCall.arguments
                : (finalExtraction.toolCall.arguments ?? {}),
            },
            null,
            this.model ?? 'unknown-model'
          );
          for (const c of seq) {
            this.res.write(formatSSEChunk(c));
          }
          this.toolCallAlreadySent = true;
        } else {
          const textChunk = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: this.model ?? 'unknown-model',
            choices: [{ index: 0, delta: { role: 'assistant', content: this.unifiedDetectionBuffer.getContent() }, finish_reason: null }]
          };
          this.res.write(formatSSEChunk(textChunk));
        }
      } finally {
        this.unifiedDetectionBuffer.clear();
        this.partialToolCallState = null;
      }
    }

    // Process any remaining non-XML data in the main buffer
    else if (this.mainBuffer.hasContent()) {
      logger.debug(
        "[STREAM PROCESSOR] Processing final buffer content:",
        this.mainBuffer.getContent(),
      );
      // Add a final separator to ensure the last piece is processed
      const finalSeparator = this.sourceFormat === FORMAT_OPENAI ? "\n\n" : "\n";
      this.mainBuffer.append(finalSeparator);
      this.processBuffer(); // Process remaining buffer content
    }

    // Explicitly flush OpenAI->Ollama detection buffer if it has content
    // This handles cases where partial tool call detection buffered content but didn't complete
    if (
      this.sourceFormat === FORMAT_OPENAI &&
      this.targetFormat === FORMAT_OLLAMA &&
      this.unifiedDetectionBufferOpenAI.hasContent()
    ) {
      logger.debug("[STREAM PROCESSOR] Flushing pending OpenAI->Ollama buffer at end of stream");
      const content = this.unifiedDetectionBufferOpenAI.getContent();
      // Create synthetic OpenAI chunk to route through SSOT conversion
      const syntheticChunk = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: this.model ?? 'unknown-model',
        choices: [{
          index: 0,
          delta: { content: content },
          finish_reason: null
        }]
      };
      // We can't await this in synchronous end(), but we can fire-and-forget 
      // or try to write directly if we trust the converter.
      // Better to use queue if possible, but end() is sync.
      // However, convertAndSendChunk is async.
      // We should try to process it.
      // Since end() is called, we are finishing up.
      // We'll treat this specially - synchronous best-effort or forcing async behavior?
      // processChunk is sync-ish. 
      // Actually, convertAndSendChunk queues it.
      this.convertAndSendChunk(syntheticChunk).catch(err => {
        logger.error("[STREAM PROCESSOR] Failed to flush final OpenAI->Ollama buffer:", err);
      });

      this.unifiedDetectionBufferOpenAI.clear();
    }

    logger.debug("[STREAM PROCESSOR] Finalizing client stream.");
    logger.info(`[FC DEBUG] end() called: targetFormat=${this.targetFormat}, doneSent=${this.doneSent}, mainBuffer="${this.mainBuffer.getContent().substring(0, 100)}"`);
    if (!this.res.writableEnded) {
      // Send final termination signal based solely on targetFormat and doneSent.
      if (!this.doneSent) {
        if (this.targetFormat === FORMAT_OPENAI) {
          logger.info("[FC DEBUG] end(): Writing SSE [DONE] for OpenAI target");
          this.res.write("data: [DONE]\n\n");
          this.doneSent = true;
        } else if (this.targetFormat === FORMAT_OLLAMA) {
          logger.info("[FC DEBUG] end(): Writing done signal for Ollama target");
          this.writeOllamaDone({
            model: this.model ?? "unknown-model",
            created_at: new Date().toISOString(),
            response: "",
          });
        }
      } else {
        logger.info("[FC DEBUG] end(): Skipping final signal (already sent)");
      }

      // Wait for any pending conversions (including final flushes) to complete
      // This ensures that async conversions triggered in end() are sent before closing
      this.conversionQueue.finally(() => {
        if (!this.res.writableEnded) {
          this.res.end();
        }
      });
    }
    this.streamClosed = true;
  }


  private sendErrorToClient(errorMessage: string): void {
    handleStreamingBackendError(
      this.res,
      new Error(errorMessage),
      'FORMAT CONVERTING STREAM PROCESSOR',
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

  closeStreamWithError(errorMessage: string): void {
    this.sendErrorToClient(errorMessage);
    this.closeStream();
  }

  handleDone(): void {
    this.end();
  }
}
