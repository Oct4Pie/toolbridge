/**
 * OpenAI SSE Stream Processor
 *
 * Handles streaming responses from OpenAI in SSE (Server-Sent Events) format.
 * - Parses `data: {...JSON...}` lines
 * - Handles `[DONE]` terminator
 * - Forwards delta.content, delta.tool_calls, finish_reason
 * - Emits final usage chunk when stream_options.include_usage was requested
 */

import { logger } from "../../logging/index.js";
import { extractToolCallFromWrapper } from "../../parsers/xml/index.js";

import type { OpenAITool, OpenAIStreamChunk } from "../../types/openai.js";
import type { StreamProcessor } from "../../types/toolbridge.js";
import type { Response } from "express";

export class OpenAISSEStreamProcessor implements StreamProcessor {
  public res: Response;
  private closed: boolean = false;
  private buffer: string = "";
  private knownToolNames: string[] = [];
  private accumulatedContent: string = "";
  private model: string = "";
  private includeUsage: boolean = false;
  private totalPromptTokens: number = 0;
  private totalCompletionTokens: number = 0;

  constructor(res: Response) {
    this.res = res;
    this.closed = false;
    this.buffer = "";
    this.knownToolNames = [];
    this.accumulatedContent = "";
    this.model = "";
    this.includeUsage = false;
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;

    // SSE headers
    this.res.setHeader("Content-Type", "text/event-stream");
    this.res.setHeader("Cache-Control", "no-cache");
    this.res.setHeader("Connection", "keep-alive");
    this.res.setHeader("Access-Control-Allow-Origin", "*");

    logger.debug("[OpenAI SSE Processor] Initialized");
  }

  setTools(tools?: OpenAITool[]): void {
    this.knownToolNames = (tools ?? [])
      .map((t) => t.function.name)
      .filter((name): name is string => typeof name === 'string');
    logger.debug("[OpenAI SSE Processor] Known tool names:", this.knownToolNames);
  }

  setStreamOptions(options?: { include_usage?: boolean }): void {
    this.includeUsage = options?.include_usage ?? false;
    logger.debug("[OpenAI SSE Processor] Stream include_usage:", this.includeUsage);
  }

  processChunk(chunk: Buffer | string): void {
    if (this.closed) {return;}

    const chunkStr = chunk.toString('utf-8');
    this.buffer += chunkStr;

    // Process complete lines
    const lines = this.buffer.split('\n');
    this.buffer = lines[lines.length - 1] ?? ""; // Keep incomplete last line in buffer

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i] ?? '';
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    if (!line) {return;} // Skip empty lines

    if (line.startsWith(': ')) {
      // SSE comment, ignore
      logger.debug("[OpenAI SSE Processor] Ignoring SSE comment");
      return;
    }

    if (!line.startsWith('data: ')) {
      logger.debug("[OpenAI SSE Processor] Unexpected line format:", line.substring(0, 50));
      return;
    }

    const data = line.substring(6).trim();

    if (data === '[DONE]') {
      logger.debug("[OpenAI SSE Processor] Received [DONE]");
      this.emitFinalChunk();
      this.end();
      return;
    }

    // Parse JSON chunk
    try {
      const parsed: OpenAIStreamChunk = JSON.parse(data);
      this.handleStreamChunk(parsed);
    } catch (e) {
      logger.warn("[OpenAI SSE Processor] Failed to parse JSON:", (e as Error).message);
    }
  }

  private handleStreamChunk(chunk: OpenAIStreamChunk): void {
    // Store model for final chunk
    if (chunk.model) {
      this.model = chunk.model;
    }

    // Store usage if present (for final emission)
    if (chunk.usage) {
      this.totalPromptTokens = chunk.usage.prompt_tokens ?? 0;
      this.totalCompletionTokens = chunk.usage.completion_tokens ?? 0;
    }

    // Forward the chunk as-is (it already has the correct SSE structure)
    // Just add SSE framing
    this.sendSSE(chunk);

    // Accumulate content for XML tool call detection
    for (const choice of chunk.choices ?? []) {
      if (choice.delta?.content) {
        this.accumulatedContent += choice.delta.content;
      }
    }

    // Check for tool calls in accumulated content (XML wrapper)
    this.detectToolCalls();
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
      logger.debug("[OpenAI SSE Processor] Detected XML tool wrapper");

      try {
        const extracted = extractToolCallFromWrapper(xmlContent);
        if (extracted) {
          logger.debug("[OpenAI SSE Processor] Successfully parsed tool call");
        }
      } catch (e) {
        logger.debug("[OpenAI SSE Processor] Failed to parse tool call:", (e as Error).message);
      }
    }
  }

  private emitFinalChunk(): void {
    if (!this.includeUsage) {
      logger.debug("[OpenAI SSE Processor] include_usage not requested, skipping final usage chunk");
      return;
    }

    // Emit final usage chunk with empty choices and usage data
    const finalChunk: OpenAIStreamChunk = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: this.model || 'unknown',
      choices: [], // Empty choices
      usage: {
        prompt_tokens: this.totalPromptTokens,
        completion_tokens: this.totalCompletionTokens,
        total_tokens: this.totalPromptTokens + this.totalCompletionTokens,
      },
    };

    logger.debug("[OpenAI SSE Processor] Emitting final usage chunk");
    this.sendSSE(finalChunk);
  }

  private sendSSE(chunk: OpenAIStreamChunk): void {
    if (this.closed) {return;}

    try {
      this.res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    } catch (e) {
      logger.error("[OpenAI SSE Processor] Failed to write SSE chunk:", (e as Error).message);
      this.end();
    }
  }

  end(): void {
    if (this.closed) {return;}

    this.closed = true;
    logger.debug("[OpenAI SSE Processor] Stream ended");

    try {
      this.res.write('data: [DONE]\n\n');
      this.res.end();
    } catch (e) {
      logger.debug("[OpenAI SSE Processor] Response already closed:", (e as Error).message);
    }
  }

  close(): void {
    this.end();
  }

  closeStream(message?: string | null): void {
    if (message) {
      logger.debug("[OpenAI SSE Processor] Closing stream with message:", message);
    }
    this.end();
  }

  closeStreamWithError(errorMessage: string): void {
    if (this.closed) {return;}

    logger.error("[OpenAI SSE Processor] Closing stream with error:", errorMessage);
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
      logger.debug("[OpenAI SSE Processor] Failed to write error:", (e as Error).message);
    }
  }
}
