/**
 * Ollama API Types
 *
 * SSOT Strategy: ALL types come from src/types/generated/ollama/
 * This file ONLY re-exports and adds request types (which cannot be auto-generated).
 */

// ============================================================
// GENERATED RESPONSE TYPES (SSOT) - Re-export ONLY
// ============================================================
export type {
  ChatResponse,
  ChatStreamChunk,
  GenerateResponse,
  ShowResponse,
  TagsResponse,
  VersionResponse,
  Model,
  Message,
  ToolCall,
  Function
} from './generated/ollama/index.js';

// Type aliases for backward compatibility
// Note: OllamaModelInfo refers to ShowResponse (detailed model info)
// while Model refers to the list item in TagsResponse
export type { ShowResponse as OllamaModelInfo } from './generated/ollama/index.js';

// Type aliases for backward compatibility and convenience
export type {
  ChatResponse as OllamaChatResponse,
  GenerateResponse as OllamaGenerateResponse,
  ShowResponse as OllamaShowResponse,
  TagsResponse as OllamaTagsResponse,
  VersionResponse as OllamaVersionResponse,
  Message as OllamaResponseMessage,
  ToolCall as OllamaToolCall,
  Function as OllamaToolFunction
} from './generated/ollama/index.js';

// ============================================================
// UNION TYPES FOR CONVERTERS
// ============================================================

// Converters handle both /api/chat (ChatResponse with message) and /api/generate (GenerateResponse with response)
import type { ChatResponse, GenerateResponse, ChatStreamChunk } from './generated/ollama/index.js';

export type OllamaResponse = ChatResponse | GenerateResponse;
export type OllamaStreamChunk = ChatStreamChunk | (GenerateResponse & { done: boolean });

// Helper type for converters that need to access both message and response fields
// This is needed because the union type doesn't allow direct access to fields that only exist on one type
export type OllamaResponseFields = {
  message?: ChatResponse['message'];
  response?: string; // GenerateResponse field
  model: string;
  created_at: string;
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
};

export type OllamaStreamChunkFields = {
  message?: ChatStreamChunk['message'];
  response?: string; // GenerateResponse streaming field
  model: string;
  created_at: string;
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
};

// ============================================================
// REQUEST TYPES (Manual - cannot be auto-generated)
// ============================================================

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
  thinking?: string;
  tool_calls?: Array<{
    id: string;
    function: {
      index?: number;
      name: string;
      arguments: Record<string, unknown>; // Object (critical: different from OpenAI's string format)
    };
  }>;
}

export interface OllamaRequest {
  model: string;
  prompt?: string; // For legacy /api/generate format
  messages?: OllamaMessage[]; // For /api/chat format
  stream?: boolean;
  format?: 'json' | Record<string, unknown>;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    repeat_penalty?: number;
    seed?: number;
    num_ctx?: number;
    num_predict?: number;
    stop?: string | string[];
  };
  template?: string;
  context?: number[];
  raw?: boolean;
  keep_alive?: string | number;
  stop?: string | string[];
  system?: string;
  tools?: unknown[]; // OpenAI tools format
  tool_choice?: string | object;
}

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  format?: 'json' | Record<string, unknown>;
  options?: OllamaRequest['options'];
  template?: string;
  context?: number[];
  raw?: boolean;
  keep_alive?: string | number;
}
