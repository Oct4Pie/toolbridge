/**
 * NdjsonFormatter - Newline-Delimited JSON Formatting Component
 *
 * SSOT Compliance: Single source of truth for NDJSON formatting (Ollama format).
 * Extracted from ollamaStreamProcessor to follow KISS principle.
 *
 * Purpose: Format chunks as newline-delimited JSON (NDJSON).
 *
 * Responsibilities:
 * - Format data chunks as "{json}\n"
 * - Format done signal with done: true flag
 * - Format error messages as NDJSON
 *
 * KISS Compliance: <80 lines, single responsibility, simple interface
 */

import { logger } from "../../../logging/index.js";

/**
 * NdjsonFormatter handles newline-delimited JSON formatting (Ollama format)
 */
export class NdjsonFormatter {
  /**
   * Format a data chunk as NDJSON
   * @param data - Data object to format
   * @returns NDJSON-formatted string "{json}\n"
   */
  formatChunk(data: unknown): string {
    return JSON.stringify(data) + "\n";
  }

  /**
   * Format the done signal
   * @param data - Optional data to include with done flag
   * @returns NDJSON-formatted done chunk
   */
  formatDone(data?: Record<string, unknown>): string {
    const doneChunk = {
      ...data,
      done: true,
    };

    return this.formatChunk(doneChunk);
  }

  /**
   * Format an error as NDJSON chunk
   * @param error - Error message
   * @param code - Error code (default: "STREAM_ERROR")
   * @returns NDJSON-formatted error chunk
   */
  formatError(error: string, code: string = "STREAM_ERROR"): string {
    const errorChunk = {
      error,
      code,
      done: true, // Mark as done on error
    };

    logger.debug(`[NDJSON FORMATTER] Formatting error: ${error} (${code})`);

    return this.formatChunk(errorChunk);
  }

  /**
   * Format a response chunk (Ollama format)
   * @param response - Response text
   * @param model - Model name
   * @param done - Whether this is the final chunk
   * @returns NDJSON-formatted response chunk
   */
  formatResponse(response: string, model: string, done: boolean = false): string {
    const chunk = {
      model,
      created_at: new Date().toISOString(),
      response,
      done,
    };

    return this.formatChunk(chunk);
  }
}
