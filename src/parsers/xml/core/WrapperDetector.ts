/**
 * Wrapper tag detection and unwrapping
 * Extracted from toolCallParser.ts for KISS compliance
 *
 * Handles <toolbridge:calls> wrapper tags used to group multiple tool calls
 */

import { extractBetweenTags } from "../utils/xmlCleaning.js";

const WRAPPER_START = "<toolbridge:calls>";
const WRAPPER_END = "</toolbridge:calls>";

/**
 * Get wrapper tag configuration
 */
export const getWrapperTags = () => ({
  start: WRAPPER_START,
  end: WRAPPER_END,
  example: `${WRAPPER_START}\n  <tool_name>\n    <parameter>value</parameter>\n  </tool_name>\n${WRAPPER_END}`,
});

/**
 * Check if text contains a toolbridge wrapper
 */
export const hasToolCallWrapper = (text: string | null | undefined): boolean => {
  if (!text) {
    return false;
  }
  return text.includes(WRAPPER_START);
};

/**
 * Remove thinking tags from content
 * LLMs sometimes wrap tool calls in thinking/reasoning tags
 */
export const removeThinkingTags = (text: string): string => {
  return text
    .replace(/◁think▷[\s\S]*?◁\/think▷/g, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '');
};

/**
 * Extract content from within wrapper tags
 * Returns null if no wrapper found
 */
export const unwrapToolCalls = (text: string): string | null => {
  const cleaned = removeThinkingTags(text);
  return extractBetweenTags(cleaned, WRAPPER_START, WRAPPER_END);
};
