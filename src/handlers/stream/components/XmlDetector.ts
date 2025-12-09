/**
 * XmlDetector - XML Tool Call Detection Component
 *
 * SSOT Compliance: Delegates to attemptPartialToolCallExtraction (SSOT for XML parsing).
 * Extracted from formatConvertingStreamProcessor to follow KISS principle.
 *
 * Purpose: Detect and extract XML tool calls from text streams.
 *
 * Responsibilities:
 * - Detect potential XML tool calls in text
 * - Identify wrapper types (toolbridge, wrapper)
 * - Extract XML chunks from mixed content
 * - Delegate to SSOT parser for actual extraction
 *
 * KISS Compliance: <100 lines, single responsibility, delegates to SSOT
 */

import { logger } from "../../../logging/index.js";
import { attemptPartialToolCallExtraction } from "../../../parsers/xml/index.js";

import type { PartialToolCallState, ExtractedToolCall } from "../../../types/index.js";

/**
 * Result of XML detection
 */
export interface XmlDetectionResult {
  /** Whether XML tool call detected */
  hasXml: boolean;
  /** XML content if detected */
  xmlContent?: string;
  /** Wrapper type if detected */
  wrapperType?: 'toolbridge' | 'wrapper' | null;
  /** Content before XML */
  contentBefore?: string;
  /** Content after XML */
  contentAfter?: string;
}

/**
 * Result of XML extraction from text
 */
export interface XmlExtractionResult {
  /** Whether extraction is complete */
  complete: boolean;
  /** Extracted tool call if complete */
  toolCall?: ExtractedToolCall | undefined;
  /** XML content that was extracted */
  content?: string | undefined;
  /** Updated partial state */
  partialState: PartialToolCallState | null;
}

/**
 * XmlDetector handles XML tool call detection in streams
 */
export class XmlDetector {
  /**
   * Quick check if text contains potential XML tool call
   * @param text - Text to check
   * @returns true if text might contain XML tool call
   */
  hasPotentialToolCall(text: string): boolean {
    // Simple check for XML-like tags that might indicate tool calls
    return text.includes('<tool_call') || text.includes('<function_call') ||
           text.includes('<toolbridge') || text.includes('<wrapper');
  }

  /**
   * Detect XML tool call and wrapper type in text
   * @param text - Text to analyze
   * @returns Detection result
   */
  detect(text: string): XmlDetectionResult {
    if (!this.hasPotentialToolCall(text)) {
      return { hasXml: false };
    }

    // Check for wrapper types
    const hasToolbridge = text.includes('<toolbridge');
    const hasWrapper = text.includes('<wrapper');

    const wrapperType = hasToolbridge ? 'toolbridge' : hasWrapper ? 'wrapper' : null;

    logger.debug(
      `[XML DETECTOR] Detected potential XML tool call (wrapper: ${wrapperType})`
    );

    return {
      hasXml: true,
      xmlContent: text,
      wrapperType,
    };
  }

  /**
   * Attempt to extract tool call from text using SSOT parser
   * @param text - Accumulated text buffer
   * @param knownToolNames - List of known tool names
   * @param partialState - Previous partial extraction state
   * @returns Extraction result with updated state
   */
  extract(
    text: string,
    knownToolNames: string[],
    partialState: PartialToolCallState | null = null
  ): XmlExtractionResult {
    // Delegate to SSOT parser
    const extraction = attemptPartialToolCallExtraction(
      text,
      knownToolNames,
      partialState
    );

    if (extraction.complete && extraction.toolCall) {
      logger.debug(
        `[XML DETECTOR] Complete tool call extracted: ${extraction.toolCall.name}`
      );
    } else if (extraction.partialState) {
      logger.debug(
        `[XML DETECTOR] Partial tool call detected, buffering...`
      );
    }

    const result: XmlExtractionResult = {
      complete: extraction.complete,
      partialState: extraction.partialState ?? null,
    };

    if (extraction.toolCall !== undefined) {
      result.toolCall = extraction.toolCall;
    }

    if (extraction.content !== undefined) {
      result.content = extraction.content;
    }

    return result;
  }
}
