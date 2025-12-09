/**
 * Format and Provider Utilities
 *
 * SSOT for format detection, type guards, and feature detection.
 * All converters and handlers should use these utilities instead of duplicating logic.
 *
 * @module translation/utils/formatUtils
 */

import type { GenericLLMRequest, GenericLLMResponse, GenericStreamChunk, GenericTool, LLMProvider } from '../types/generic.js';

/**
 * Check if request is for Ollama provider
 *
 * @param req - Generic LLM request
 * @returns true if provider is 'ollama'
 */
export function isOllamaRequest(req: GenericLLMRequest): boolean {
  return req.provider === 'ollama';
}

/**
 * Check if request is for OpenAI provider
 *
 * @param req - Generic LLM request
 * @returns true if provider is 'openai'
 */
export function isOpenAIRequest(req: GenericLLMRequest): boolean {
  return req.provider === 'openai';
}

/**
 * Check if response is from Ollama provider
 *
 * @param res - Generic LLM response
 * @returns true if provider is 'ollama'
 */
export function isOllamaResponse(res: GenericLLMResponse): boolean {
  return res.provider === 'ollama';
}

/**
 * Check if response is from OpenAI provider
 *
 * @param res - Generic LLM response
 * @returns true if provider is 'openai'
 */
export function isOpenAIResponse(res: GenericLLMResponse): boolean {
  return res.provider === 'openai';
}

/**
 * Check if stream chunk is from Ollama provider
 *
 * @param chunk - Generic stream chunk
 * @returns true if provider is 'ollama'
 */
export function isOllamaChunk(chunk: GenericStreamChunk): boolean {
  return chunk.provider === 'ollama';
}

/**
 * Check if stream chunk is from OpenAI provider
 *
 * @param chunk - Generic stream chunk
 * @returns true if provider is 'openai'
 */
export function isOpenAIChunk(chunk: GenericStreamChunk): boolean {
  return chunk.provider === 'openai';
}

/**
 * Check if request has tools defined
 *
 * @param req - Generic LLM request
 * @returns true if request has tools array with at least one tool
 */
export function hasTools(req: GenericLLMRequest): boolean {
  return Array.isArray(req.tools) && req.tools.length > 0;
}

/**
 * Check if request requires tool handling
 * Alias for hasTools for semantic clarity
 *
 * @param req - Generic LLM request
 * @returns true if request requires tool handling
 */
export function requiresToolHandling(req: GenericLLMRequest): boolean {
  return hasTools(req);
}

/**
 * Check if response contains tool calls
 *
 * @param res - Generic LLM response
 * @returns true if any choice has tool calls
 */
export function hasToolCalls(res: GenericLLMResponse): boolean {
  if (!res.choices || res.choices.length === 0) {
    return false;
  }

  return res.choices.some(choice => {
    return choice.message.tool_calls && choice.message.tool_calls.length > 0;
  });
}

/**
 * Check if stream chunk contains tool calls
 *
 * @param chunk - Generic stream chunk
 * @returns true if any choice delta has tool calls
 */
export function hasToolCallsInChunk(chunk: GenericStreamChunk): boolean {
  if (!chunk.choices || chunk.choices.length === 0) {
    return false;
  }

  return chunk.choices.some(choice => {
    return choice.delta.tool_calls && choice.delta.tool_calls.length > 0;
  });
}

/**
 * Get the number of tools in a request
 *
 * @param req - Generic LLM request
 * @returns number of tools, or 0 if none
 */
export function getToolCount(req: GenericLLMRequest): number {
  return Array.isArray(req.tools) ? req.tools.length : 0;
}

/**
 * Get tool names from a tools array
 * Extracted to eliminate duplication (DRY principle)
 * Accepts both GenericTool[] and OpenAI-style tool arrays
 *
 * @param tools - Array of tools (generic or OpenAI format)
 * @returns array of tool function names
 */
export function extractToolNames(
  tools: Array<{ function: { name: string } } | GenericTool>
): string[] {
  if (!Array.isArray(tools) || tools.length === 0) {
    return [];
  }

  return tools
    .map(tool => tool.function.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

/**
 * Get tool names from a request
 *
 * @param req - Generic LLM request
 * @returns array of tool function names
 */
export function getToolNames(req: GenericLLMRequest): string[] {
  return extractToolNames(req.tools ?? []);
}

/**
 * Get provider display name for logging
 *
 * @param provider - LLM provider identifier
 * @returns human-readable provider name
 */
export function getProviderDisplayName(provider: LLMProvider): string {
  switch (provider) {
    case 'ollama':
      return 'Ollama';
    case 'openai':
      return 'OpenAI';
    default:
      return 'Unknown';
  }
}

/**
 * Check if request is streaming
 *
 * @param req - Generic LLM request
 * @returns true if stream is explicitly enabled
 */
export function isStreamingRequest(req: GenericLLMRequest): boolean {
  return req.stream === true;
}

/**
 * Check if request has JSON response format
 *
 * @param req - Generic LLM request
 * @returns true if response format is json_object or json_schema
 */
export function hasJsonResponseFormat(req: GenericLLMRequest): boolean {
  if (!req.responseFormat) {
    return false;
  }

  if (req.responseFormat === 'json_object') {
    return true;
  }

  if (typeof req.responseFormat === 'object' && req.responseFormat.type === 'json_schema') {
    return true;
  }

  return false;
}

/**
 * Check if tool choice is required
 *
 * @param req - Generic LLM request
 * @returns true if toolChoice is 'required' or a specific function
 */
export function isToolChoiceRequired(req: GenericLLMRequest): boolean {
  if (!req.toolChoice) {
    return false;
  }

  if (req.toolChoice === 'required') {
    return true;
  }

  // Specific function selection also counts as required
  if (typeof req.toolChoice === 'object' && req.toolChoice.type === 'function') {
    return true;
  }

  return false;
}

/**
 * Check if tools array is empty or undefined
 *
 * @param tools - Optional tools array
 * @returns true if tools is undefined or empty array
 */
export function isToolsEmpty(tools: GenericTool[] | undefined): boolean {
  return !tools || tools.length === 0;
}
