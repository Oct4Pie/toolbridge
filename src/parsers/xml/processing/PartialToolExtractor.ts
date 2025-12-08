/**
 * Partial/incomplete tool call extraction for streaming
 * Extracted from toolCallParser.ts for KISS compliance
 *
 * Handles incomplete XML in streaming scenarios where tool calls
 * arrive chunk by chunk.
 */

import { config } from "../../../config.js";
import { logger } from "../../../logging/index.js";
import { detectPotentialToolCall } from "../utils/toolCallDetection.js";

import { htmlStartRegex } from "./HtmlFilter.js";

import type {
  ExtractedToolCall,
  PartialExtractionResult,
  PartialToolCallState,
  ToolCallDetectionResult,
} from "../../../types/index.js";

const MAX_BUFFER_SIZE = config.performance.maxToolCallBufferSize;

/**
 * Create reset state for when content is confirmed not to be a tool call
 * Extracted to eliminate duplicate code (DRY principle)
 */
const createResetState = (): PartialExtractionResult => ({
  complete: false,
  partialState: {
    rootTag: null,
    isPotential: false,
    mightBeToolCall: false,
    buffer: '',
    identifiedToolName: null,
  },
});

/**
 * Extract a complete tool call from content that contains an HTML tag
 * Searches for tool call tags after the HTML content
 */
const extractToolCallAfterHtml = (
  content: string,
  knownToolNames: string[],
  extractToolCallFn: (text: string, knownToolNames: string[]) => ExtractedToolCall | null,
): ExtractedToolCall | null => {
  for (const toolName of knownToolNames) {
    const startIndex = content.indexOf(`<${toolName}`);
    if (startIndex > 0) {
      const closingTagPattern = new RegExp(`</${toolName}>`, 'i');
      const closingMatch = content.match(closingTagPattern);
      if (closingMatch?.index !== undefined && closingMatch.index > startIndex) {
        const endIndex = closingMatch.index + closingMatch[0].length;
        const toolCallContent = content.substring(startIndex, endIndex);
        const extracted = extractToolCallFn(toolCallContent, knownToolNames);
        if (extracted && extracted.name.toLowerCase() === toolName.toLowerCase()) {
          return extracted;
        }
      }
    }
  }
  return null;
};

/**
 * Try to extract a complete tool call when detection confirms it's complete
 */
const tryExtractCompleteToolCall = (
  workingContent: string,
  detection: ToolCallDetectionResult,
  knownToolNames: string[],
  extractToolCallFn: (text: string, knownToolNames: string[]) => ExtractedToolCall | null,
): ExtractedToolCall | null => {
  if (detection.isCompletedXml) {
    const extracted = extractToolCallFn(workingContent, knownToolNames);
    if (extracted) {
      return extracted;
    }
  }

  if (detection.rootTagName) {
    for (const toolName of knownToolNames) {
      if (toolName.toLowerCase() === detection.rootTagName.toLowerCase()) {
        const tagRegex = new RegExp(`<${toolName}[^>]*?>([\\s\\S]*?)<\\/${toolName}>`, 'gi');
        let match: RegExpExecArray | null;
        while ((match = tagRegex.exec(workingContent)) !== null) {
          const potentialTool = match[0];
          const extracted = extractToolCallFn(potentialTool, knownToolNames);
          if (extracted && extracted.name.toLowerCase() === toolName.toLowerCase()) {
            return extracted;
          }
        }
      }
    }
  }

  return null;
};

/**
 * Attempt to extract a partial/incomplete tool call from streaming content
 *
 * This is the main entry point for partial extraction during streaming.
 * It handles:
 * - HTML tag detection (reject if HTML)
 * - Buffer size limits (prevent memory issues)
 * - Tool call detection
 * - Complete tool extraction when available
 * - Partial state buffering for incomplete calls
 *
 * @param content - Current accumulated content
 * @param knownToolNames - List of known tool names
 * @param previousState - State from previous extraction attempt
 * @param extractToolCallFn - Function to extract complete tool calls (injected to avoid circular dependency)
 * @returns Extraction result with either complete tool call or partial state
 */
export const attemptPartialToolCallExtraction = (
  content: string,
  knownToolNames: string[],
  previousState: PartialToolCallState | null,
  extractToolCallFn: (text: string, knownToolNames: string[]) => ExtractedToolCall | null,
): PartialExtractionResult => {
  const htmlMatch = content.match(htmlStartRegex);

  if (htmlMatch) {
    const htmlTag = htmlMatch[1];
    logger.debug(`[XML Parser] Content starts with common HTML tag "${htmlTag}" - skipping extraction`);

    if (previousState?.mightBeToolCall === true) {
      logger.debug('[XML Parser] Previously buffered content is now confirmed to be HTML. Resetting buffer.');
    }

    // Try to find tool call after HTML
    const extracted = extractToolCallAfterHtml(content, knownToolNames, extractToolCallFn);
    if (extracted) {
      return {
        complete: true,
        toolCall: extracted,
        content: content,
      };
    }

    return {
      complete: false,
      partialState: {
        rootTag: null,
        isPotential: false,
        mightBeToolCall: false,
        buffer: '',
        identifiedToolName: null,
      },
    };
  }

  let workingContent = content;

  // Enforce buffer size limit
  if (workingContent.length > MAX_BUFFER_SIZE) {
    logger.debug(`[XML Parser] Buffer size (${workingContent.length} chars) exceeds maximum (${MAX_BUFFER_SIZE}). Resetting buffer.`);
    const lastPart = workingContent.substring(workingContent.length - MAX_BUFFER_SIZE);
    const prelimDetection = detectPotentialToolCall(lastPart, knownToolNames);
    if (!prelimDetection.mightBeToolCall) {
      return {
        complete: false,
        partialState: {
          rootTag: null,
          isPotential: false,
          mightBeToolCall: false,
          buffer: '',
          identifiedToolName: null,
        },
      };
    }
    workingContent = lastPart;
  }

  const detection: ToolCallDetectionResult = detectPotentialToolCall(workingContent, knownToolNames);

  if (detection.rootTagName && !detection.mightBeToolCall) {
    logger.debug(`[XML Parser] Tag "${detection.rootTagName}" confirmed not to be a tool call. Not buffering content.`);
    return createResetState();
  }

  if (previousState?.mightBeToolCall && !detection.mightBeToolCall) {
    logger.debug('[XML Parser] Previously buffered content is now confirmed not to be a tool call. Resetting buffer.');
    return createResetState();
  }

  if (detection.mightBeToolCall) {
    try {
      const extracted = tryExtractCompleteToolCall(workingContent, detection, knownToolNames, extractToolCallFn);
      if (extracted) {
        return {
          complete: true,
          toolCall: extracted,
          content: workingContent,
        };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.debug('[XML Parser] Error during tool call extraction:', message);
    }
  }

  if (
    previousState?.mightBeToolCall &&
    !detection.mightBeToolCall &&
    detection.rootTagName
  ) {
    logger.debug('[XML Parser] Previously buffered content is now confirmed not to be a tool call. Resetting buffer.');
    return createResetState();
  }

  return {
    complete: false,
    partialState: {
      rootTag: detection.rootTagName,
      isPotential: detection.isPotential,
      mightBeToolCall: detection.mightBeToolCall,
      buffer: detection.mightBeToolCall ? workingContent : '',
      identifiedToolName: detection.rootTagName ?? previousState?.identifiedToolName ?? null,
    },
  };
};
