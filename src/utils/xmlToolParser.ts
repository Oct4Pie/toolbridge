import logger from "./logger.js";

import type { ExtractedToolCall } from "../types/index.js";

/**
 * Robust XML Tool Call Parser with Wrapper Tags
 * 
 * This parser ONLY processes tool calls within specific wrapper tags,
 * making it immune to false positives from regular XML/HTML content.
 */

// Configurable wrapper tags - using namespace approach for maximum uniqueness
const WRAPPER_START = '<toolbridge:calls>';
const WRAPPER_END = '</toolbridge:calls>';
const WRAPPER_START_ALT = '<__toolcall__>';  // Alternative for backwards compatibility
const WRAPPER_END_ALT = '</__toolcall__>';

// Helper: extract content between two tags (hoisted so callers below can use it)

/**
 * Extract content between specific tags
 * Looks for the LAST complete wrapper to avoid getting wrapper tags mentioned in thinking
 */
function extractBetweenTags(text: string, startTag: string, endTag: string): string | null {
  // Find all occurrences of the wrapper tags
  const startIndices: number[] = [];
  let searchIndex = 0;
  
  while (searchIndex < text.length) {
    const index = text.indexOf(startTag, searchIndex);
    if (index === -1) {break;}
    startIndices.push(index);
    searchIndex = index + 1;
  }
  
  // No start tags found
  if (startIndices.length === 0) {return null;}
  
  // Try from the last occurrence first (most likely to be the actual tool call)
  for (let i = startIndices.length - 1; i >= 0; i--) {
    const startIndex = startIndices[i];
    const contentStart = startIndex + startTag.length;
    const endIndex = text.indexOf(endTag, contentStart);
    
    if (endIndex !== -1) {
      const content = text.substring(contentStart, endIndex).trim();
      
      // Quick validation: should start with < and contain a tool name
      if (content.startsWith('<') && content.includes('>')) {
        return content;
      }
    }
  }
  
  return null;
}

/**
 * Parse tool call XML (only called for content within wrapper tags)
 */
/**
 * Parse tool call XML (only called for content within wrapper tags)
 */

/**
 * Extract nested object from XML
 */
/**
 * Parse primitive values (string, number, boolean)
 */
function parseValue(value: string): string | number | boolean {
  const trimmed = value.trim();

  // Boolean
  if (trimmed.toLowerCase() === 'true') {return true;}
  if (trimmed.toLowerCase() === 'false') {return false;}

  // Number
  if (!isNaN(Number(trimmed)) && trimmed !== '') {
    return Number(trimmed);
  }

  // String (default)
  return trimmed;
}


/**
 * Extract nested object from XML
 */
function extractNestedObject(xml: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const paramRegex = /<([a-zA-Z0-9_.-]+)>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;

  while ((match = paramRegex.exec(xml)) !== null) {
    const key = match[1];
    let value: unknown = match[2];

    // Check if this is another nested object
    if (typeof value === 'string' && value.includes('<') && value.includes('>')) {
      value = extractNestedObject(value);
    } else {
      value = parseValue(value as string);
    }

    obj[key] = value;
  }

  return obj;
}


/**
 * Extract parameters from tool XML
 */
function extractParameters(xml: string, toolName: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  // Create regex to extract content within tool tags
  const contentRegex = new RegExp(
    `<\\s*${toolName}[^>]*>([\\s\\S]*?)<\\/${toolName}>`,
    'i'
  );

  const contentMatch = xml.match(contentRegex);
  if (!contentMatch?.[1]) {
    return params;
  }

  const content = contentMatch[1];

  // Extract each parameter
  const paramRegex = /<([a-zA-Z0-9_.-]+)>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;

  while ((match = paramRegex.exec(content)) !== null) {
    const paramName = match[1];
    let paramValue: unknown = match[2];

    // Handle nested objects
    if (typeof paramValue === 'string' && paramValue.includes('<') && paramValue.includes('>')) {
      // This is a nested object, parse recursively
      paramValue = extractNestedObject(paramValue);
    } else {
      // Parse primitive values
      paramValue = parseValue(paramValue as string);
    }

    params[paramName] = paramValue;
  }

  return params;
}

function parseToolCallXML(xml: string, knownToolNames: string[]): ExtractedToolCall | null {
  // Find the root element
  const rootMatch = xml.match(/^<\s*([a-zA-Z0-9_.-]+)/);
  if (!rootMatch?.[1]) {
    logger.debug("[XML Tool Parser] No valid root element in wrapped content");
    return null;
  }
  
  const toolName = rootMatch[1];
  
  // CRITICAL: Validate tool name against known tools
  if (!knownToolNames.includes(toolName)) {
    logger.warn(`[XML Tool Parser] Tool '${toolName}' not in known tools list`);
    return null;
  }
  
  logger.debug(`[XML Tool Parser] Valid tool found: ${toolName}`);
  
  // Extract parameters
  try {
    const params = extractParameters(xml, toolName);
    return {
      name: toolName,
      arguments: params
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[XML Tool Parser] Failed to extract parameters: ${errorMessage}`);
    return null;
  }
}

export function extractToolCallFromWrapper(
  text: string | null | undefined,
  knownToolNames: string[] = []
): ExtractedToolCall | null {
  if (!text || typeof text !== "string") {
    return null;
  }

  // Create a clean copy for parsing ONLY (preserve original for display)
  let textForParsing = text;

  // Remove thinking tags ONLY for parsing - keep them in actual response
  // This ensures parser works while preserving reasoning for users who want it
  textForParsing = textForParsing.replace(/◁think▷[\s\S]*?◁\/think▷/g, '');
  textForParsing = textForParsing.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  textForParsing = textForParsing.replace(/<think>[\s\S]*?<\/think>/gi, '');
  textForParsing = textForParsing.replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '');

  logger.debug(`[XML Tool Parser] Checking for wrapped tool calls (original: ${text.length} chars, cleaned for parsing: ${textForParsing.length} chars)`);

  // Check for primary wrapper in the cleaned text
  let wrappedContent = extractBetweenTags(textForParsing, WRAPPER_START, WRAPPER_END);

  // Fallback to alternative wrapper (use original text)
  wrappedContent = wrappedContent ?? extractBetweenTags(textForParsing, WRAPPER_START_ALT, WRAPPER_END_ALT);

  // If no wrapper found, return null immediately (no parsing attempted)
  if (!wrappedContent) {
    logger.debug("[XML Tool Parser] No wrapper tags found - skipping parse");
    return null;
  }

  logger.debug(`[XML Tool Parser] Found wrapped content: ${wrappedContent.substring(0, 100)}...`);

  // Now parse the wrapped content for tool calls
  return parseToolCallXML(wrappedContent, knownToolNames);
}

/**
 * Check if text contains wrapper tags (quick check without parsing)
 */
export function hasToolCallWrapper(text: string | null | undefined): boolean {
  if (!text) {return false;}
  return text.includes(WRAPPER_START) || text.includes(WRAPPER_START_ALT);
}

/**
 * Get the wrapper tags for system prompt
 */
export function getWrapperTags(): {
  start: string;
  end: string;
  example: string;
} {
  return {
    start: WRAPPER_START,
    end: WRAPPER_END,
    example: `${WRAPPER_START}\n  <tool_name>\n    <parameter>value</parameter>\n  </tool_name>\n${WRAPPER_END}`
  };
}

export default {
  extractToolCallFromWrapper,
  hasToolCallWrapper,
  getWrapperTags
};