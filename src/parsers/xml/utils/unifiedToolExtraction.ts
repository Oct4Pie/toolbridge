/**
 * Unified Tool Extraction - Single Source of Truth
 *
 * This module provides a unified extraction strategy that:
 * 1. First tries wrapper-based extraction (<toolbridge:calls>)
 * 2. Falls back to direct extraction if no wrapper found
 *
 * This ensures compatibility with models that follow instructions (use wrapper)
 * AND models that don't follow instructions perfectly (emit raw XML).
 *
 * SSOT Compliance:
 * - All tool extraction should route through extractToolCallUnified/extractToolCallsUnified
 * - Eliminates duplicate extraction logic across handlers
 * - Single place to modify extraction strategy
 */

import { logger } from "../../../logging/index.js";

import {
  extractToolCall,
  extractToolCallFromWrapper,
  extractToolCallsFromWrapper,
} from "../toolCallParser.js";

import type { ExtractedToolCall } from "../../../types/index.js";

/**
 * Extract a single tool call using unified strategy.
 *
 * Strategy:
 * 1. Try wrapper-based extraction first (preferred - model followed instructions)
 * 2. Fall back to direct extraction (model didn't use wrapper)
 *
 * @param text - Text containing potential tool call
 * @param knownToolNames - List of known tool names to match
 * @returns Extracted tool call or null if not found
 */
export function extractToolCallUnified(
  text: string | null | undefined,
  knownToolNames: string[] = []
): ExtractedToolCall | null {
  if (!text || typeof text !== "string") {
    return null;
  }

  // Strategy 1: Try wrapper-based extraction first
  // This is preferred because it means the model followed instructions
  const wrapperResult = extractToolCallFromWrapper(text, knownToolNames);
  if (wrapperResult) {
    logger.debug(
      `[Unified Extraction] Successfully extracted tool call "${wrapperResult.name}" via wrapper`
    );
    return wrapperResult;
  }

  // Strategy 2: Fall back to direct extraction
  // Model didn't use wrapper but may have output valid XML tool call
  const directResult = extractToolCall(text, knownToolNames);
  if (directResult) {
    logger.debug(
      `[Unified Extraction] Successfully extracted tool call "${directResult.name}" via direct extraction (no wrapper)`
    );
    return directResult;
  }

  logger.debug("[Unified Extraction] No tool call found via wrapper or direct extraction");
  return null;
}

/**
 * Extract multiple tool calls using unified strategy.
 *
 * Strategy:
 * 1. Try wrapper-based extraction first (preferred - model followed instructions)
 * 2. Fall back to direct extraction for each known tool (model didn't use wrapper)
 *
 * @param text - Text containing potential tool calls
 * @param knownToolNames - List of known tool names to match
 * @returns Array of extracted tool calls (may be empty)
 */
export function extractToolCallsUnified(
  text: string | null | undefined,
  knownToolNames: string[] = []
): ExtractedToolCall[] {
  if (!text || typeof text !== "string") {
    return [];
  }

  // Strategy 1: Try wrapper-based extraction first
  const wrapperResults = extractToolCallsFromWrapper(text, knownToolNames);
  if (wrapperResults.length > 0) {
    logger.debug(
      `[Unified Extraction] Successfully extracted ${wrapperResults.length} tool call(s) via wrapper`
    );
    return wrapperResults;
  }

  // Strategy 2: Fall back to direct extraction
  // Scan for each known tool name in the content
  const directResults: ExtractedToolCall[] = [];
  const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const toolName of knownToolNames) {
    const pattern = new RegExp(
      `<\\s*(?:[A-Za-z0-9_.:-]+:)?${escapeRegExp(toolName)}\\b[\\s\\S]*?<\\/${escapeRegExp(toolName)}>`,
      "gi"
    );

    for (const match of text.matchAll(pattern)) {
      if (match[0]) {
        const extracted = extractToolCall(match[0], knownToolNames);
        if (extracted) {
          // Avoid duplicates
          const isDuplicate = directResults.some(
            (existing) =>
              existing.name === extracted.name &&
              JSON.stringify(existing.arguments) === JSON.stringify(extracted.arguments)
          );
          if (!isDuplicate) {
            directResults.push(extracted);
          }
        }
      }
    }
  }

  if (directResults.length > 0) {
    logger.debug(
      `[Unified Extraction] Successfully extracted ${directResults.length} tool call(s) via direct extraction (no wrapper)`
    );
    return directResults;
  }

  // Final fallback: try single extraction
  const singleResult = extractToolCall(text, knownToolNames);
  if (singleResult) {
    logger.debug(
      `[Unified Extraction] Successfully extracted single tool call "${singleResult.name}" via direct extraction`
    );
    return [singleResult];
  }

  logger.debug("[Unified Extraction] No tool calls found via wrapper or direct extraction");
  return [];
}
