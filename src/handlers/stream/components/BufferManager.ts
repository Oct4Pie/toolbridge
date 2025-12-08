/**
 * BufferManager - Stream Buffering Component
 *
 * SSOT Compliance: Single source of truth for string buffering in stream processing.
 * Extracted from formatConvertingStreamProcessor to follow KISS principle.
 *
 * Purpose: Manage string buffering with overflow protection and buffer limits.
 *
 * Responsibilities:
 * - Accumulate string chunks with size limits
 * - Detect buffer overflow conditions
 * - Provide buffer content and state queries
 * - Clear buffer when needed
 *
 * KISS Compliance: <150 lines, single responsibility, simple interface
 */

import { config } from "../../../config.js";
import { logger } from "../../../logging/index.js";

/**
 * BufferManager handles string accumulation with size limits
 */
export class BufferManager {
  private buffer: string = "";
  private readonly maxSize: number;
  private readonly name: string;

  /**
   * Create a new BufferManager
   * @param maxSize - Maximum buffer size in bytes (defaults to config.performance.maxStreamBufferSize)
   * @param name - Buffer name for logging (optional)
   */
  constructor(maxSize?: number, name: string = "StreamBuffer") {
    this.maxSize = maxSize ?? config.performance.maxStreamBufferSize;
    this.name = name;

    logger.debug(
      `[BUFFER MANAGER] Initialized ${this.name} with max size ${this.maxSize} bytes`
    );
  }

  /**
   * Append a chunk to the buffer
   * @param chunk - String chunk to append
   * @returns true if truncation occurred to fit within max size, false otherwise
   */
  append(chunk: string): boolean {
    const newSize = this.buffer.length + chunk.length;
    let truncated = false;

    if (newSize > this.maxSize) {
      // Graceful degradation: truncate buffer to keep most recent data
      logger.warn(
        `[BUFFER MANAGER] ${this.name} would overflow: ${newSize} > ${this.maxSize} bytes. Truncating to fit.`
      );
      
      // Append the chunk first
      this.buffer += chunk;
      
      // Then truncate from the beginning to keep the most recent data
      const overflow = this.buffer.length - this.maxSize;
      this.buffer = this.buffer.slice(overflow);
      truncated = true;
      
      logger.warn(
        `[BUFFER MANAGER] ${this.name} truncated ${overflow} bytes from start, new size: ${this.buffer.length}/${this.maxSize}`
      );
    } else {
      this.buffer += chunk;

      logger.debug(
        `[BUFFER MANAGER] ${this.name} appended ${chunk.length} bytes, total: ${this.buffer.length}/${this.maxSize}`
      );
    }

    return truncated;
  }

  /**
   * Get current buffer content
   * @returns Current buffer string
   */
  getContent(): string {
    return this.buffer;
  }

  /**
   * Get current buffer size
   * @returns Buffer size in bytes
   */
  getSize(): number {
    return this.buffer.length;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    const previousSize = this.buffer.length;
    this.buffer = "";

    if (previousSize > 0) {
      logger.debug(
        `[BUFFER MANAGER] ${this.name} cleared (was ${previousSize} bytes)`
      );
    }
  }

  /**
   * Check if buffer has content
   * @returns true if buffer is not empty
   */
  hasContent(): boolean {
    return this.buffer.length > 0;
  }

  /**
   * Check if buffer is empty
   * @returns true if buffer is empty
   */
  isEmpty(): boolean {
    return this.buffer.length === 0;
  }

  /**
   * Get remaining capacity
   * @returns Remaining bytes that can be appended
   */
  getRemainingCapacity(): number {
    return this.maxSize - this.buffer.length;
  }

  /**
   * Check if chunk can be appended without overflow
   * @param chunk - String chunk to check
   * @returns true if chunk can be safely appended
   */
  canAppend(chunk: string): boolean {
    return this.buffer.length + chunk.length <= this.maxSize;
  }

  /**
   * Get buffer utilization percentage
   * @returns Percentage of buffer used (0-100)
   */
  getUtilization(): number {
    return (this.buffer.length / this.maxSize) * 100;
  }

  /**
   * Extract content and clear buffer atomically
   * @returns Buffer content before clearing
   */
  extractAndClear(): string {
    const content = this.buffer;
    this.clear();
    return content;
  }

  /**
   * Replace buffer content (use sparingly)
   * @param content - New content to set
   * @returns true if truncation occurred to fit within max size, false otherwise
   */
  setContent(content: string): boolean {
    let truncated = false;

    if (content.length > this.maxSize) {
      logger.warn(
        `[BUFFER MANAGER] ${this.name} setContent exceeds max size: ${content.length} > ${this.maxSize}. Truncating to fit.`
      );
      
      // Keep the most recent data (from the end)
      const overflow = content.length - this.maxSize;
      this.buffer = content.slice(overflow);
      truncated = true;
      
      logger.warn(
        `[BUFFER MANAGER] ${this.name} truncated ${overflow} bytes from start, new size: ${this.buffer.length}/${this.maxSize}`
      );
    } else {
      this.buffer = content;

      logger.debug(
        `[BUFFER MANAGER] ${this.name} content set to ${content.length} bytes`
      );
    }

    return truncated;
  }
}
