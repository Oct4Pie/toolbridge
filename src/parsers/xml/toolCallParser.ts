/**
 * Tool Call Parser - Thin Orchestrator
 * Refactored from 754-line monolith for KISS compliance
 *
 * This file now orchestrates specialized modules:
 * - core/XmlBalancer: Element balancing and region finding
 * - core/WrapperDetector: Wrapper tag detection and unwrapping
 * - core/ParameterExtractor: Parameter parsing from XML
 * - processing/PartialToolExtractor: Streaming/partial extraction
 * - utils/*: Low-level parsing utilities
 */

import { logger } from "../../logging/index.js";


import { buildArgumentsFromXml } from "./core/ParameterExtractor.js";
import {
  getWrapperTags,
  hasToolCallWrapper,
  unwrapToolCalls,
} from "./core/WrapperDetector.js";
import {
  findBalancedElement,
  synthesizeRegionForUnbalancedElement,
} from "./core/XmlBalancer.js";
import { attemptPartialToolCallExtraction as attemptPartialExtraction } from "./processing/PartialToolExtractor.js";
import { preprocessForParsing } from "./utils/xmlCleaning.js";
import { parseStartTag } from "./utils/xmlParsing.js";
import { parseJSONToolCall } from "./utils/jsonFallback.js";

import type {
  ExtractedToolCall,
  PartialExtractionResult,
  PartialToolCallState,
} from "../../types/index.js";

/**
 * Normalize known tool names to lowercase set
 */
const normalizeKnownToolNames = (knownToolNames: string[]): Set<string> => {
  return new Set(knownToolNames.map((name) => name.toLowerCase()));
};

/**
 * Extract a complete tool call from XML text
 *
 * @param text - XML text containing tool call
 * @param knownToolNames - List of known tool names to search for
 * @returns Extracted tool call or null if not found
 */
export const extractToolCall = (
  text: string | null | undefined,
  knownToolNames: string[] = [],
): ExtractedToolCall | null => {
  if (!text || typeof text !== 'string') {
    logger.debug('[XML Parser] Empty or invalid input text.');
    return null;
  }

  logger.debug(`[XML Parser] Attempting to extract tool call from text (length: ${text.length})`);
  const knownToolSet = normalizeKnownToolNames(knownToolNames);

  const processed = preprocessForParsing(text);
  if (!processed) {
    logger.debug('[XML Parser] No `<` character found. Not XML.');
    return null;
  }

  let working = processed;

  // If not well-formed XML, try to extract known tool elements
  if (!working.startsWith('<') || !working.endsWith('>')) {
    if (knownToolNames.length > 0) {
      // First try: match complete closing tags (</name>)
      const toolRegexPattern = knownToolNames
        .map((name) => `<\\s*${name}[\\s\\S]*?<\\/${name}>`)
        .join('|');
      const toolFindRegex = new RegExp(`(${toolRegexPattern})`, 'i');
      const potentialToolMatch = working.match(toolFindRegex);

      if (potentialToolMatch?.[0]) {
        working = potentialToolMatch[0];
      } else {
        // Second try: match incomplete closing tags (</name without final >)
        // This handles streaming edge cases where the > hasn't arrived yet
        // or is missing due to malformed output
        const lenientToolRegexPattern = knownToolNames
          .map((name) => `<\\s*${name}[\\s\\S]*?<\\/${name}>?`)
          .join('|');
        const lenientToolFindRegex = new RegExp(`(${lenientToolRegexPattern})`, 'i');
        const lenientMatch = working.match(lenientToolFindRegex);

        if (lenientMatch?.[0]) {
          // Append the missing '>' if needed for valid XML
          let matched = lenientMatch[0];
          if (!matched.endsWith('>')) {
            matched = matched + '>';
          }
          working = matched;
        } else {
          return null;
        }
      }
    } else {
      return null;
    }
  }

  let chosen: { name: string; local: string; region: { start: number; openEnd: number; closeStart: number; end: number } } | null = null;

  // Try to match root element against known tools
  if (working.startsWith('<')) {
    const rootStart = parseStartTag(working, 0);
    if (rootStart) {
      const local = rootStart.local.toLowerCase();
      const matchTool = knownToolNames.find((tool) => tool.toLowerCase() === local);
      if (matchTool) {
        const region = findBalancedElement(working, local, 0);
        const resolvedRegion = region ?? synthesizeRegionForUnbalancedElement(working, rootStart);
        if (resolvedRegion) {
          chosen = { name: matchTool, local, region: resolvedRegion };
        }
      }
    }
  }

  // If root element doesn't match, scan for known tools
  if (!chosen) {
    let earliest: { idx: number; tool: string } | null = null;
    for (const tool of knownToolNames) {
      const regex = new RegExp(`<\\s*(?:[A-Za-z0-9_.-]+:)?${tool}\\b`, 'i');
      const match = regex.exec(working);
      if (match && (earliest === null || match.index < earliest.idx)) {
        earliest = { idx: match.index, tool };
      }
    }

    if (earliest) {
      const local = earliest.tool.toLowerCase();
      const startAtIdx = parseStartTag(working, earliest.idx);
      if (startAtIdx && startAtIdx.local.toLowerCase() === local) {
        const region = findBalancedElement(working, local, earliest.idx);
        const resolvedRegion = region ?? synthesizeRegionForUnbalancedElement(working, startAtIdx);
        if (resolvedRegion) {
          chosen = { name: earliest.tool, local, region: resolvedRegion };
        }
      }
    }
  }

  if (!chosen) {
    logger.debug('[XML Parser] No matching tool element found after scanning.');
    return null;
  }

  const inner = working.slice(chosen.region.openEnd, chosen.region.closeStart);
  const argumentsObject = buildArgumentsFromXml(inner, {
    rawToolNames: knownToolSet,
    rootToolName: chosen.local,
  });

  logger.debug(`[XML Parser] Successfully extracted parameters for '${chosen.name}'`);

  return {
    name: chosen.name,
    arguments: argumentsObject,
  };
};

/**
 * Extract tool call from wrapper tags
 * Handles <toolbridge:calls> wrapper and thinking tags
 *
 * @param text - Text potentially containing wrapped tool calls
 * @param knownToolNames - List of known tool names
 * @returns Extracted tool call or null if not found
 */
export const extractToolCallFromWrapper = (
  text: string | null | undefined,
  knownToolNames: string[] = [],
): ExtractedToolCall | null => {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const unwrapped = unwrapToolCalls(text);
  if (!unwrapped) {
    return null;
  }

  return extractToolCall(unwrapped, knownToolNames);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const extractToolCallsFromWrapper = (
  text: string | null | undefined,
  knownToolNames: string[] = [],
): ExtractedToolCall[] => {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const unwrapped = unwrapToolCalls(text);
  if (!unwrapped) {
    return [];
  }

  const segments: Array<{ snippet: string; index: number }> = [];
  for (const toolName of knownToolNames) {
    const pattern = new RegExp(`<\\s*(?:[A-Za-z0-9_.:-]+:)?${escapeRegExp(toolName)}\\b[\\s\\S]*?<\\/${escapeRegExp(toolName)}>`, 'gi');
    for (const match of unwrapped.matchAll(pattern)) {
      if (match[0]) {
        segments.push({ snippet: match[0], index: match.index ?? 0 });
      }
    }
  }

  segments.sort((a, b) => a.index - b.index);

  const results: ExtractedToolCall[] = [];
  for (const segment of segments) {
    const toolCall = extractToolCall(segment.snippet, knownToolNames);
    if (toolCall) {
      results.push(toolCall);
    }
  }

  if (results.length > 0) {
    return results;
  }

  const singleCall = extractToolCall(unwrapped, knownToolNames);
  return singleCall ? [singleCall] : [];
};

/**
 * Attempt to extract partial/incomplete tool calls from streaming content
 *
 * @param content - Current accumulated content
 * @param knownToolNames - List of known tool names
 * @param previousState - State from previous extraction attempt
 * @returns Extraction result with either complete tool call or partial state
 */
export const attemptPartialToolCallExtraction = (
  content: string,
  knownToolNames: string[] = [],
  previousState: PartialToolCallState | null = null,
): PartialExtractionResult => {
  // Create a composed extractor that tries strict XML first, then JSON fallback
  // This ensures streaming detection (which detects both) can extract both
  const composedExtractor = (text: string, tools: string[]) => {
    return extractToolCall(text, tools) ?? parseJSONToolCall(text, tools);
  };

  return attemptPartialExtraction(content, knownToolNames, previousState, composedExtractor);
};

// Re-export wrapper detection utilities
export { getWrapperTags, hasToolCallWrapper };
