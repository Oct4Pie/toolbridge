/**
 * OpenAI API Types
 *
 * SSOT Strategy: ALL types come from src/types/generated/openai/
 * This file ONLY re-exports and adds request types (which cannot be auto-generated).
 */

// ============================================================
// GENERATED RESPONSE TYPES (SSOT) - Re-export ONLY
// ============================================================
export type {
  ChatCompletionResponse,
  ChatCompletionStreamChunk,
  ModelsListResponse,
  Model as OpenAIModel,
  Choice,
  Message,
  ToolCall,
  ToolFunction,
  ReasoningDetail,
  Usage,
  CompletionTokensDetails,
  Delta
} from './generated/openai/index.js';

// Type aliases for backward compatibility
export type {
  ChatCompletionResponse as OpenAIResponse,
  ChatCompletionStreamChunk as OpenAIStreamChunk,
  ModelsListResponse as OpenAIModelsListResponse,
  Choice as OpenAIChoice,
  Message as OpenAIResponseMessage,
  Usage as OpenAIUsage,
  ToolCall as OpenAIToolCall,
  Delta as OpenAIStreamDelta
} from './generated/openai/index.js';

// ============================================================
// UTILITY TYPES FOR CONVERTERS/HANDLERS
// ============================================================

// Streaming delta can have partial fields during streaming (first chunk has role, content chunks have content)
import type { Delta } from './generated/openai/index.js';
export type StreamingDelta = Partial<Delta>;

// ============================================================
// REQUEST TYPES (Manual - cannot be auto-generated)
// ============================================================

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
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string; // JSON string
    };
  }>;
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
