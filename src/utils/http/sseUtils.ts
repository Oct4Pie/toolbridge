/**
 * SSE (Server-Sent Events) Utilities
 *
 * Pure transport-level SSE formatting functions.
 * Provider-specific chunk creation has been moved to translation layer converters.
 */

/**
 * Formats data as an SSE chunk.
 * This is a pure transport-level function - not provider-specific.
 */
export function formatSSEChunk(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}