/**
 * Ollama Line-JSON Stream Processor
 *
 * Handles streaming responses from Ollama native API in line-delimited JSON format.
 * Converts to OpenAI SSE format for client consumption:
 * - Parses line-JSON format from Ollama (one JSON per line)
 * - Accumulates content until `done: true`
 * - Converts to OpenAI SSE chunks with `data: {...}` format
 * - Handles XML tool wrapper detection
 * - Emits final usage chunk when requested
 *
 * REFACTORED: Now extends BaseStreamProcessor for DRY compliance
 */

import { logger } from "../../../logging/index.js";
import { BaseStreamProcessor } from "../base/BaseStreamProcessor.js";

import type { OllamaStreamChunkFields } from "../../../types/ollama.js";
import type { OpenAIStreamChunk } from "../../../types/openai.js";
import type { Response } from "express";

export class OllamaLineJSONStreamProcessor extends BaseStreamProcessor {
  protected readonly processorName = "Ollama Line-JSON Processor";

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
    const lastIndex = lines.length - 1;
    this.state.buffer = lastIndex >= 0 && lines[lastIndex] !== undefined ? lines[lastIndex] : "";

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      if (line !== undefined) {
        this.processLine(line);
      }
    }
  }

  private processLine(line: string): void {
    if (!line.trim()) { return; }

    try {
      const ollamaResponse: OllamaStreamChunkFields = JSON.parse(line);
      this.handleOllamaChunk(ollamaResponse);
    } catch (e) {
      logger.warn(`[${this.processorName}] Failed to parse JSON line:`, (e as Error).message);
    }
  }

  private handleOllamaChunk(response: OllamaStreamChunkFields): void {
    // Store model for final chunk
    if (response.model) {
      this.state.model = response.model;
    }

    const content = typeof response.response === "string" ? response.response : "";

    // If tools configured, use SSOT partial extraction before emitting text
    if (!this.state.toolCallAlreadySent && this.state.knownToolNames.length > 0 && content) {
      const result = this.processToolCallDetection(content);

      if (result.handled) {
        // Content is being handled (either buffering or complete tool call)
        if (result.toolCallChunks) {
          // Tool call is complete - emit preface and tool calls
          if (result.prefaceContent) {
            const prefaceChunk = this.createContentChunk(result.prefaceContent);
            this.sendSSE(prefaceChunk);
          }
          for (const chunk of result.toolCallChunks) {
            this.sendSSE(chunk);
          }
        }
        // Whether complete or still buffering, do NOT emit the raw content
        return;
      }

      // handled is false - not a tool call, flush any buffered content
      if (result.prefaceContent) {
        const textChunk = this.createContentChunk(result.prefaceContent);
        this.sendSSE(textChunk);
      }
      return;
    } else if (content && !this.state.toolCallAlreadySent) {
      // No tools configured, or already sent tool call; treat as normal text
      const openaiChunk = this.createContentChunk(content);
      this.sendSSE(openaiChunk);
    }

    // End of stream: finalize unified buffer and send [DONE]
    if (response.done === true) {
      logger.debug(`[${this.processorName}] Stream completed (done=true)`);
      this.handleStreamEnd(response);
    }
  }

  private handleStreamEnd(lastResponse: OllamaStreamChunkFields): void {
    // Try final tool call extraction
    const result = this.finalizeToolCallDetection();

    if (result.prefaceContent) {
      const textChunk = this.createContentChunk(result.prefaceContent);
      this.sendSSE(textChunk);
    }

    if (result.toolCallChunks) {
      for (const chunk of result.toolCallChunks) {
        this.sendSSE(chunk);
      }
    }

    this.emitFinalChunk(lastResponse);
    this.end();
  }

  private emitFinalChunk(lastResponse: OllamaStreamChunkFields): void {
    if (!this.state.includeUsage) {
      logger.debug(`[${this.processorName}] include_usage not requested, skipping final usage chunk`);
      return;
    }

    // Synthesize usage from Ollama response if available
    const completionTokens = (lastResponse as unknown as { eval_count?: number }).eval_count ?? 0;
    const promptTokens =
      (lastResponse as unknown as { prompt_eval_count?: number }).prompt_eval_count ?? 0;

    const finalChunk: OpenAIStreamChunk = {
      id: `chatcmpl-${Date.now()}-final`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: this.state.model || "ollama",
      choices: [],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
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
      // Send final Ollama NDJSON done signal
      const doneChunk = {
        model: this.state.model || "unknown-model",
        created_at: new Date().toISOString(),
        message: { role: "assistant", content: "" },
        done: true,
      };
      this.res.write(JSON.stringify(doneChunk) + "\n");
      this.res.end();
    } catch (e) {
      logger.debug(`[${this.processorName}] Response already closed:`, (e as Error).message);
    }
  }

  close(): void {
    this.end();
  }
}
