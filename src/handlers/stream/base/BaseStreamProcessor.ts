/**
 * BaseStreamProcessor - Abstract Base Class for Stream Processors
 *
 * SSOT/DRY/KISS Compliance:
 * - Extracts common functionality from OllamaLineJSONStreamProcessor and OpenAISSEStreamProcessor
 * - Single source for buffer management, tool call detection, and stream lifecycle
 * - Reduces code duplication by ~40% across stream processors
 *
 * This base class handles:
 * - Response/buffer lifecycle management
 * - Tool name extraction and storage
 * - Stream options (include_usage)
 * - Common SSE header setup
 * - Unified tool call detection via SSOT parser
 */

import { config } from "../../../config.js";
import { logger } from "../../../logging/index.js";
import { attemptPartialToolCallExtraction } from "../../../parsers/xml/index.js";
import { OpenAIConverter } from "../../../translation/converters/openai-simple.js";
import { handleStreamingBackendError } from "../../../utils/http/errorResponseHandler.js";

import type { OpenAITool, OpenAIStreamChunk } from "../../../types/openai.js";
import type { PartialToolCallState, StreamProcessor } from "../../../types/toolbridge.js";
import type { Response } from "express";

/**
 * Common state for all stream processors
 */
export interface BaseStreamState {
  closed: boolean;
  buffer: string;
  knownToolNames: string[];
  unifiedBuffer: string;
  partialToolCallState: PartialToolCallState | null;
  toolCallAlreadySent: boolean;
  model: string;
  includeUsage: boolean;
  chunkCount: number;
}

/**
 * Tool call extraction result
 */
export interface ToolExtractionResult {
  handled: boolean;
  prefaceContent?: string | undefined;
  toolCallChunks?: OpenAIStreamChunk[] | undefined;
  remainder?: string | undefined;
}

/**
 * Abstract base class for stream processors
 * Subclasses implement format-specific chunk handling
 */
export abstract class BaseStreamProcessor implements StreamProcessor {
  public res: Response;
  protected state: BaseStreamState;
  protected readonly openaiConverter: OpenAIConverter;
  protected abstract readonly processorName: string;

  constructor(res: Response) {
    this.res = res;
    this.openaiConverter = new OpenAIConverter();
    this.state = {
      closed: false,
      buffer: "",
      knownToolNames: [],
      unifiedBuffer: "",
      partialToolCallState: null,
      toolCallAlreadySent: false,
      model: "",
      includeUsage: false,
      chunkCount: 0,
    };
  }

  /**
   * Initialize common SSE headers
   */
  protected initializeSSEHeaders(): void {
    this.res.setHeader("Content-Type", "text/event-stream");
    this.res.setHeader("Cache-Control", "no-cache");
    this.res.setHeader("Connection", "keep-alive");
    this.res.setHeader("Access-Control-Allow-Origin", "*");
    logger.debug(`[${this.processorName}] Initialized`);
  }

  /**
   * Set known tool names from tools array
   */
  setTools(tools?: OpenAITool[]): void {
    this.state.knownToolNames = (tools ?? [])
      .map((t) => t.function.name)
      .filter((name): name is string => typeof name === "string");
    logger.debug(`[${this.processorName}] Known tool names:`, this.state.knownToolNames);
  }

  /**
   * Set stream options (include_usage)
   */
  setStreamOptions(options?: { include_usage?: boolean }): void {
    this.state.includeUsage = options?.include_usage ?? false;
    logger.debug(`[${this.processorName}] Stream include_usage:`, this.state.includeUsage);
  }

  /**
   * Process incoming chunk - delegates to format-specific handler
   */
  abstract processChunk(chunk: Buffer | string): void;

  /**
   * Helper to generate tool call chunks and update state
   * @private
   */
  private generateToolCallResult(
    extraction: { toolCall: { name: string; arguments: unknown }; content?: string },
    bufferContent: string
  ): ToolExtractionResult {
    const xmlContent = extraction.content ?? "";
    const idx = bufferContent.indexOf(xmlContent);
    const preface = idx > 0 ? bufferContent.substring(0, idx) : "";

    const toolCallChunks = this.openaiConverter.createToolCallStreamSequence(
      {
        name: extraction.toolCall.name,
        arguments:
          typeof extraction.toolCall.arguments === "string"
            ? extraction.toolCall.arguments
            : ((extraction.toolCall.arguments ?? {}) as Record<string, unknown>),
      },
      null,
      this.state.model || "unknown"
    );

    this.state.toolCallAlreadySent = true;
    const endPos = idx + xmlContent.length;
    const remainder = endPos < bufferContent.length ? bufferContent.substring(endPos) : "";
    this.state.unifiedBuffer = remainder;
    this.state.partialToolCallState = null;

    return {
      handled: true,
      prefaceContent: preface || undefined,
      toolCallChunks,
      remainder: remainder || undefined,
    };
  }

  /**
   * Process content through SSOT tool call detection
   * Returns extraction result with handled status and any generated chunks
   */
  protected processToolCallDetection(content: string): ToolExtractionResult {
    if (this.state.toolCallAlreadySent || this.state.knownToolNames.length === 0) {
      return { handled: false };
    }

    this.state.unifiedBuffer += content;

    const extraction = attemptPartialToolCallExtraction(
      this.state.unifiedBuffer,
      this.state.knownToolNames,
      this.state.partialToolCallState
    );

    if (extraction.complete && extraction.toolCall) {
      return this.generateToolCallResult(extraction as { toolCall: { name: string; arguments: unknown }; content?: string }, this.state.unifiedBuffer);
    }

    // Update partial state
    this.state.partialToolCallState = extraction.partialState ?? null;

    if (!this.state.partialToolCallState?.mightBeToolCall) {
      // Not a potential tool call - return buffer content for immediate emission
      const contentToFlush = this.state.unifiedBuffer;
      this.state.unifiedBuffer = "";
      return { handled: false, prefaceContent: contentToFlush };
    }

    // Keep buffering - enforce max buffer size
    const max = config.performance.maxToolCallBufferSize;
    if (this.state.unifiedBuffer.length > max) {
      this.state.unifiedBuffer = this.state.unifiedBuffer.slice(-max);
    }

    return { handled: true }; // Handled by buffering
  }

  /**
   * Flush any remaining buffer content as text
   */
  protected flushUnifiedBuffer(): string | null {
    if (!this.state.unifiedBuffer) {
      return null;
    }
    const content = this.state.unifiedBuffer;
    this.state.unifiedBuffer = "";
    this.state.partialToolCallState = null;
    return content;
  }

  /**
   * Handle final tool call extraction at stream end
   */
  protected finalizeToolCallDetection(): ToolExtractionResult {
    if (
      this.state.toolCallAlreadySent ||
      this.state.knownToolNames.length === 0 ||
      !this.state.unifiedBuffer
    ) {
      const remaining = this.flushUnifiedBuffer();
      return { handled: false, prefaceContent: remaining ?? undefined };
    }

    const extraction = attemptPartialToolCallExtraction(
      this.state.unifiedBuffer,
      this.state.knownToolNames,
      this.state.partialToolCallState
    );

    if (extraction.complete && extraction.toolCall) {
      const result = this.generateToolCallResult(
        extraction as { toolCall: { name: string; arguments: unknown }; content?: string },
        this.state.unifiedBuffer
      );
      // Clear remainder since this is final
      this.state.unifiedBuffer = "";
      return result;
    }

    // No tool call found - return remaining buffer as text
    const remaining = this.flushUnifiedBuffer();
    return { handled: false, prefaceContent: remaining ?? undefined };
  }

  /**
   * Send SSE chunk to response
   */
  protected sendSSE(chunk: OpenAIStreamChunk): void {
    if (this.state.closed) {return;}

    try {
      this.res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      this.state.chunkCount++;
    } catch (e) {
      logger.error(`[${this.processorName}] Failed to write SSE chunk:`, (e as Error).message);
      this.end();
    }
  }

  /**
   * Create a content chunk using OpenAI converter
   */
  protected createContentChunk(content: string): OpenAIStreamChunk {
    return this.openaiConverter.createStreamChunk(
      null,
      this.state.model || "unknown",
      content,
      null
    );
  }

  /**
   * End the stream
   */
  abstract end(): void;

  /**
   * Close stream with optional message
   */
  closeStream(message?: string | null): void {
    if (message) {
      logger.debug(`[${this.processorName}] Closing stream with message:`, message);
    }
    this.end();
  }

  /**
   * Close stream with error
   */
  closeStreamWithError(errorMessage: string): void {
    handleStreamingBackendError(
      this.res,
      new Error(errorMessage),
      this.processorName,
      `Stream error: ${errorMessage}`
    );
    this.state.closed = true;
  }

  /**
   * Check if stream is closed
   */
  protected isClosed(): boolean {
    return this.state.closed;
  }

  /**
   * Mark stream as closed
   */
  protected markClosed(): void {
    this.state.closed = true;
  }
}
