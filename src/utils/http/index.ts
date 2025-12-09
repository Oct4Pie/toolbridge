/**
 * HTTP Module
 *
 * HTTP-related utilities for headers, streaming, and SSE.
 * Note: OpenAI-specific chunk creation functions have been moved to
 * the translation layer (OpenAIConverter) to maintain SSOT.
 */

export { buildBackendHeaders } from './headerUtils.js';
export { formatSSEChunk } from './sseUtils.js';
export { streamToString } from './streamUtils.js';
