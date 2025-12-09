/**
 * SseFormatter - Server-Sent Events Formatting Component
 *
 * SSOT Compliance: Single source of truth for SSE formatting.
 * Extracted from openaiStreamProcessor to follow KISS principle.
 *
 * Purpose: Format chunks as Server-Sent Events (SSE) protocol.
 *
 * Responsibilities:
 * - Format data chunks as SSE "data: {json}\n\n"
 * - Format done signal as "data: [DONE]\n\n"
 * - Format error messages as SSE chunks
 *
 * KISS Compliance: <100 lines, single responsibility, simple interface
 */

import { logger } from "../../../logging/index.js";
import { formatSSEChunk } from "../../../utils/http/index.js";

/**
 * SseFormatter handles Server-Sent Events formatting
 */
export class SseFormatter {
  /**
   * Format a data chunk as SSE
   * @param data - Data object to format
   * @returns SSE-formatted string "data: {json}\n\n"
   */
  formatChunk(data: unknown): string {
    return formatSSEChunk(data);
  }

  /**
   * Format the done signal
   * @returns SSE-formatted done signal "data: [DONE]\n\n"
   */
  formatDone(): string {
    return "data: [DONE]\n\n";
  }

  /**
   * Format an error as SSE chunk
   * @param error - Error message
   * @param code - Error code (default: "STREAM_ERROR")
   * @returns SSE-formatted error chunk
   */
  formatError(error: string, code: string = "STREAM_ERROR"): string {
    const errorChunk = {
      error: {
        message: error,
        code,
      },
    };

    logger.debug(`[SSE FORMATTER] Formatting error: ${error} (${code})`);

    return formatSSEChunk(errorChunk);
  }

  /**
   * Format a content delta chunk (OpenAI format)
   * @param content - Content delta
   * @param model - Model name
   * @param index - Choice index (default: 0)
   * @returns SSE-formatted content chunk
   */
  formatContentDelta(content: string, model: string, index: number = 0): string {
    const chunk = {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index,
          delta: { content },
          finish_reason: null,
        },
      ],
    };

    return formatSSEChunk(chunk);
  }

  /**
   * Format a finish chunk (OpenAI format)
   * @param model - Model name
   * @param finishReason - Finish reason (default: "stop")
   * @param index - Choice index (default: 0)
   * @returns SSE-formatted finish chunk
   */
  formatFinish(
    model: string,
    finishReason: string = "stop",
    index: number = 0
  ): string {
    const chunk = {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index,
          delta: {},
          finish_reason: finishReason,
        },
      ],
    };

    return formatSSEChunk(chunk);
  }
}
