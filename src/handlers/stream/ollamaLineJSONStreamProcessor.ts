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
 */

import { logger } from "../../logging/index.js";
import { extractToolCallFromWrapper } from "../../parsers/xml/index.js";

import type { OllamaResponse } from "../../types/ollama.js";
import type { OpenAITool, OpenAIStreamChunk } from "../../types/openai.js";
import type { StreamProcessor } from "../../types/toolbridge.js";
import type { Response } from "express";

export class OllamaLineJSONStreamProcessor implements StreamProcessor {
  public res: Response;
  private closed: boolean = false;
  private buffer: string = "";
  private knownToolNames: string[] = [];
  private accumulatedContent: string = "";
  private model: string = "";
  private includeUsage: boolean = false;
  private chunkCount: number = 0;

  constructor(res: Response) {
    this.res = res;
    this.closed = false;
    this.buffer = "";
    this.knownToolNames = [];
    this.accumulatedContent = "";
    this.model = "";
    this.includeUsage = false;
    this.chunkCount = 0;

    // SSE headers
    this.res.setHeader("Content-Type", "text/event-stream");
    this.res.setHeader("Cache-Control", "no-cache");
    this.res.setHeader("Connection", "keep-alive");
    this.res.setHeader("Access-Control-Allow-Origin", "*");

    logger.debug("[Ollama Line-JSON Processor] Initialized");
  }

  setTools(tools?: OpenAITool[]): void {
    this.knownToolNames = (tools ?? [])
      .map((t) => t.function.name)
      .filter((name): name is string => typeof name === 'string');
    logger.debug("[Ollama Line-JSON Processor] Known tool names:", this.knownToolNames);
  }

  setStreamOptions(options?: { include_usage?: boolean }): void {
    this.includeUsage = options?.include_usage ?? false;
    logger.debug("[Ollama Line-JSON Processor] Stream include_usage:", this.includeUsage);
  }

  processChunk(chunk: Buffer | string): void {
    if (this.closed) {return;}

    const chunkStr = chunk.toString('utf-8');
    this.buffer += chunkStr;

    // Process complete lines
    const lines = this.buffer.split('\n');
    this.buffer = lines[lines.length - 1] ?? ""; // Keep incomplete last line

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i] ?? '';
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    if (!line.trim()) {return;} // Skip empty lines

    try {
      const ollamaResponse: OllamaResponse = JSON.parse(line);
      this.handleOllamaChunk(ollamaResponse);
    } catch (e) {
      logger.warn("[Ollama Line-JSON Processor] Failed to parse JSON line:", (e as Error).message);
    }
  }

  private handleOllamaChunk(response: OllamaResponse): void {
    // Store model for final chunk
    if (response.model) {
      this.model = response.model;
    }

    // Accumulate content
    if (response.response) {
      this.accumulatedContent += response.response;
    }

    // Convert Ollama response to OpenAI SSE chunk (only if there's content)
    if (response.response || !response.done) {
      const openaiChunk = this.convertToOpenAIChunk(response);
      this.sendSSE(openaiChunk);
      this.chunkCount += 1;
    }

    // Check for end of stream
    if (response.done === true) {
      logger.debug("[Ollama Line-JSON Processor] Stream completed (done=true)");
      this.emitFinalChunk(response);
      this.end();
    }

    // Detect tool calls in accumulated content
    this.detectToolCalls();
  }

  private convertToOpenAIChunk(response: OllamaResponse): OpenAIStreamChunk {
    const chunk: OpenAIStreamChunk = {
      id: `chatcmpl-${Date.now()}-${this.chunkCount}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: this.model || response.model || 'ollama',
      choices: [
        {
          index: 0,
          delta: {
            content: response.response ?? null,
          },
          finish_reason: response.done === true ? 'stop' : null,
        },
      ],
    };

    return chunk;
  }

  private detectToolCalls(): void {
    // Look for XML tool wrapper in accumulated content
    const wrapperStart = this.accumulatedContent.indexOf('<toolbridge:calls>');
    const wrapperEnd = this.accumulatedContent.indexOf('</toolbridge:calls>');

    if (wrapperStart !== -1 && wrapperEnd !== -1) {
      const xmlContent = this.accumulatedContent.substring(
        wrapperStart,
        wrapperEnd + '</toolbridge:calls>'.length,
      );
      logger.debug("[Ollama Line-JSON Processor] Detected XML tool wrapper");

      try {
        const extracted = extractToolCallFromWrapper(xmlContent);
        if (extracted) {
          logger.debug("[Ollama Line-JSON Processor] Successfully parsed tool call");
        }
      } catch (e) {
        logger.debug("[Ollama Line-JSON Processor] Failed to parse tool call:", (e as Error).message);
      }
    }
  }

  private emitFinalChunk(lastResponse: OllamaResponse): void {
    if (!this.includeUsage) {
      logger.debug("[Ollama Line-JSON Processor] include_usage not requested, skipping final usage chunk");
      return;
    }

    // Synthesize usage from Ollama response if available
    // Ollama provides eval_count (completion tokens) and prompt_eval_count (prompt tokens)
    const completionTokens = (lastResponse as unknown as { eval_count?: number }).eval_count ?? 0;
    const promptTokens = (lastResponse as unknown as { prompt_eval_count?: number }).prompt_eval_count ?? 0;

    const finalChunk: OpenAIStreamChunk = {
      id: `chatcmpl-${Date.now()}-final`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: this.model || 'ollama',
      choices: [], // Empty choices
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };

    logger.debug("[Ollama Line-JSON Processor] Emitting final usage chunk");
    this.sendSSE(finalChunk);
  }

  private sendSSE(chunk: OpenAIStreamChunk): void {
    if (this.closed) {return;}

    try {
      this.res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    } catch (e) {
      logger.error("[Ollama Line-JSON Processor] Failed to write SSE chunk:", (e as Error).message);
      this.end();
    }
  }

  end(): void {
    if (this.closed) {return;}

    this.closed = true;
    logger.debug("[Ollama Line-JSON Processor] Stream ended");

    try {
      this.res.write('data: [DONE]\n\n');
      this.res.end();
    } catch (e) {
      logger.debug("[Ollama Line-JSON Processor] Response already closed:", (e as Error).message);
    }
  }

  close(): void {
    this.end();
  }

  closeStream(message?: string | null): void {
    if (message) {
      logger.debug("[Ollama Line-JSON Processor] Closing stream with message:", message);
    }
    this.end();
  }

  closeStreamWithError(errorMessage: string): void {
    if (this.closed) {return;}

    logger.error("[Ollama Line-JSON Processor] Closing stream with error:", errorMessage);
    this.closed = true;

    try {
      const errorChunk: OpenAIStreamChunk = {
        id: `chatcmpl-error-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: this.model || 'error',
        choices: [
          {
            index: 0,
            delta: {
              content: `\n\nError: ${errorMessage}`,
            },
            finish_reason: 'stop',
          },
        ],
      };

      this.res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
      this.res.write('data: [DONE]\n\n');
      this.res.end();
    } catch (e) {
      logger.debug("[Ollama Line-JSON Processor] Failed to write error:", (e as Error).message);
    }
  }
}
