/**
 * Wrapper tag detection and unwrapping
 * Extracted from toolCallParser.ts for KISS compliance
 *
 * Handles <toolbridge_calls> wrapper tags used to group multiple tool calls
 */

import { extractBetweenTags } from "../utils/xmlCleaning.js";

const WRAPPER_START = "<toolbridge_calls>";
const WRAPPER_END = "</toolbridge_calls>";

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
 * 
 * IMPORTANT: Strips thinking tags BEFORE extraction to prevent parsing
 * tool calls that appear inside <think></think> blocks (model reasoning).
 * The thinking tags are preserved in the actual output stream - this
 * stripping only affects tool call parsing.
 */
export const unwrapToolCalls = (text: string): string | null => {
  // Strip thinking tags before extraction - tool calls inside <think> are
  // model reasoning/planning, NOT actual tool invocations
  const withoutThinking = removeThinkingTags(text);
  return extractBetweenTags(withoutThinking, WRAPPER_START, WRAPPER_END);
};
