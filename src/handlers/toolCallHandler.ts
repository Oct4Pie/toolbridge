/**
 * DEPRECATED: This file now re-exports from the parser layer.
 *
 * LAYERING FIX: detectPotentialToolCall moved to src/parsers/xml/utils/toolCallDetection.ts
 * Handlers should not contain parsing logic - parsers should not import from handlers.
 *
 * This re-export maintains backward compatibility.
 */
export { detectPotentialToolCall } from "../parsers/xml/utils/toolCallDetection.js";