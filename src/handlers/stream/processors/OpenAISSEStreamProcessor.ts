/**
 * OpenAI SSE Stream Processor
 *
 * Handles streaming responses from OpenAI in SSE (Server-Sent Events) format.
 * - Parses `data: {...JSON...}` lines
 * - Handles `[DONE]` terminator
 * - Forwards delta.content, delta.tool_calls, finish_reason
 * - Emits final usage chunk when stream_options.include_usage was requested
 *
 * REFACTORED: Now extends BaseStreamProcessor for DRY compliance
 */

import { logger } from "../../../logging/index.js";
import { BaseStreamProcessor } from "../base/BaseStreamProcessor.js";

import type { OpenAIStreamChunk } from "../../../types/openai.js";
import type { Response } from "express";

export class OpenAISSEStreamProcessor extends BaseStreamProcessor {
  protected readonly processorName = "OpenAI SSE Processor";
  private totalPromptTokens: number = 0;
  private totalCompletionTokens: number = 0;

  constructor(res: Response) {
    super(res);
    this.initializeSSEHeaders();
  }

  processChunk(chunk: Buffer | string): void {
    if (this.isClosed()) { return; }

    const chunkStr = chunk.toString("utf-8");
    this.state.buffer += chunkStr;

    // Process complete lines
    const lines = this.state.buffer.split("\n");
    this.state.buffer = lines[lines.length - 1] ?? "";

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i] ?? "";
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    if (!line) { return; }

    if (line.startsWith(": ")) {
      // SSE comment, ignore
      logger.debug(`[${this.processorName}] Ignoring SSE comment`);
      return;
    }

    if (!line.startsWith("data: ")) {
      logger.debug(`[${this.processorName}] Unexpected line format:`, line.substring(0, 50));
      return;
    }

    const data = line.substring(6).trim();

    if (data === "[DONE]") {
      logger.debug(`[${this.processorName}] Received [DONE]`);
      // CRITICAL: Finalize any pending tool call detection before ending
      const finalResult = this.finalizeToolCallDetection();
      if (finalResult.handled && finalResult.toolCallChunks) {
        // Emit any preface content first
        if (finalResult.prefaceContent) {
          const prefaceChunk = this.createContentChunk(finalResult.prefaceContent);
          this.sendSSE(prefaceChunk);
        }
        // Emit tool call chunks
        for (const tc of finalResult.toolCallChunks) {
          this.sendSSE(tc);
        }
        logger.debug(`[${this.processorName}] Finalized tool call at stream end`);
      } else if (finalResult.prefaceContent) {
        // Flush any remaining buffered content as text
        const textChunk = this.createContentChunk(finalResult.prefaceContent);
        this.sendSSE(textChunk);
      }
      this.emitFinalChunk();
      this.end();
      return;
    }

    // Parse JSON chunk
    try {
      const parsed: OpenAIStreamChunk = JSON.parse(data);
      this.handleStreamChunk(parsed);
    } catch (e) {
      logger.warn(`[${this.processorName}] Failed to parse JSON:`, (e as Error).message);
    }
  }

  private handleStreamChunk(chunk: OpenAIStreamChunk): void {
    // Store model for final chunk
    if (chunk.model) {
      this.state.model = chunk.model;
    }

    // Store usage if present (for final emission)
    if (chunk.usage) {
      this.totalPromptTokens = chunk.usage.prompt_tokens ?? 0;
      this.totalCompletionTokens = chunk.usage.completion_tokens ?? 0;
    }

    // Check if this chunk has a finish_reason (important for signaling stream end)
    const finishReason = chunk.choices?.[0]?.finish_reason;

    // Gather delta content (text) for tool-call detection
    let contentDelta = "";
    for (const choice of chunk.choices ?? []) {
      if (typeof choice.delta?.content === "string") {
        contentDelta += choice.delta.content;
      }
    }

    // Run SSOT tool-call detection before forwarding
    const detectionResult = contentDelta
      ? this.processToolCallDetection(contentDelta)
      : { handled: false };

    if (detectionResult.handled) {
      // Content is being handled (either buffering or complete tool call)
      if (detectionResult.toolCallChunks) {
        // Tool call is complete - emit preface and tool calls
        if (detectionResult.prefaceContent) {
          const prefaceChunk = this.createContentChunk(detectionResult.prefaceContent);
          this.sendSSE(prefaceChunk);
        }
        for (const tc of detectionResult.toolCallChunks) {
          this.sendSSE(tc);
        }
      }
      // Whether complete or still buffering, do NOT forward the raw chunk
      return;
    }

    // handled is false - not a tool call
    if (detectionResult.prefaceContent !== undefined) {
      // Flush any buffered text as a clean content chunk
      const flushedChunk = this.createContentChunk(detectionResult.prefaceContent);
      this.sendSSE(flushedChunk);

      // CRITICAL: If original chunk had finish_reason, send a separate finish chunk
      // This ensures the client knows the stream is complete
      if (finishReason) {
        const finishChunk: OpenAIStreamChunk = {
          id: chunk.id || `chatcmpl-${Date.now()}`,
          object: "chat.completion.chunk",
          created: chunk.created || Math.floor(Date.now() / 1000),
          model: chunk.model || this.state.model || "unknown",
          choices: [{
            index: 0,
            delta: {},
            finish_reason: finishReason,
          }],
        };
        this.sendSSE(finishChunk);
      }
      return;
    }

    // Default behavior: forward the original chunk as-is
    this.sendSSE(chunk);
  }

  private emitFinalChunk(): void {
    if (!this.state.includeUsage) {
      logger.debug(`[${this.processorName}] include_usage not requested, skipping final usage chunk`);
      return;
    }

    const finalChunk: OpenAIStreamChunk = {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: this.state.model || "unknown",
      choices: [],
      usage: {
        prompt_tokens: this.totalPromptTokens,
        completion_tokens: this.totalCompletionTokens,
        total_tokens: this.totalPromptTokens + this.totalCompletionTokens,
      },
    };

    logger.debug(`[${this.processorName}] Emitting final usage chunk`);
    this.sendSSE(finalChunk);
  }

  end(): void {
    if (this.isClosed()) { return; }

    this.markClosed();
    logger.debug(`[${this.processorName}] Stream ended`);

    try {
      this.res.write("data: [DONE]\n\n");
      this.res.end();
    } catch (e) {
      logger.debug(`[${this.processorName}] Response already closed:`, (e as Error).message);
    }
  }

  close(): void {
    this.end();
  }
}
