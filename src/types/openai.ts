/**
 * OpenAI API Types
 */

export interface OpenAIFunction {
  name: string;
  description?: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface OpenAITool {
  type: 'function';
  function: OpenAIFunction;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Message content can be either a simple string or an array of content parts.
 * Array format supports multimodal content (text, images, etc.) as per OpenAI spec.
 */
export type OpenAIMessageContent = string | null | Array<{
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
  [key: string]: unknown;
}>;

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: OpenAIMessageContent;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  tool_choice?: 'none' | 'auto' | { type: 'function'; function: { name: string } };
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  // Advanced options (not all providers support these)
  response_format?: { type: 'json_object' | 'text' } | { type: 'json_schema'; json_schema?: unknown };
  stream_options?: { include_usage?: boolean };
  logprobs?: boolean;
  top_logprobs?: number;
  seed?: number;
  n?: number;
  user?: string;
  presence_penalty?: number;
  frequency_penalty?: number;
  // Legacy support
  functions?: OpenAIFunction[];
  function_call?: 'none' | 'auto' | { name: string };
  [key: string]: unknown;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: unknown;
  [key: string]: unknown;
}

export interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  logprobs?: unknown;
  native_finish_reason?: string;
}

export interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  provider?: string;
  choices: OpenAIChoice[];
  usage: OpenAIUsage;
}

// Streaming types
/**
 * Streaming chunk for chat completions.
 * The final chunk may have:
 * - empty choices[] and usage (if stream_options.include_usage was true)
 * - a single delta with finish_reason
 * - followed by [DONE] marker
 */
export interface OpenAIStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  provider?: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
    logprobs?: unknown;
  }>;
  usage?: OpenAIUsage; // Optional; present on final chunk if stream_options.include_usage
  [key: string]: unknown;
}