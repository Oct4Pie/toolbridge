/**
 * Type definitions index - exports all types used throughout ToolBridge
 */

// ToolBridge core types
export type * from './toolbridge.js';

// OpenAI types (aliased to avoid conflicts with Ollama)
export type {
  OpenAIRequest,
  OpenAIResponse,
  OpenAIStreamChunk,
  OpenAITool,
  OpenAIFunction,
  OpenAIMessage,
  StreamingDelta
} from './openai.js';

// Re-export OpenAI Model type from generated sources
export type { Datum as OpenAIModel } from './generated/openai/models-list.js';

// Ollama types (aliased to avoid conflicts with OpenAI)
export type {
  OllamaRequest,
  OllamaResponse,
  OllamaStreamChunk,
  OllamaMessage,
  OllamaModelInfo,
  OllamaResponseFields,
  OllamaStreamChunkFields
} from './ollama.js';

// Express extensions - REMOVED: Not used in codebase
// Node.js stream extensions - REMOVED: Not used in codebase

// Environment variables
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PROXY_HOST: string;
      PROXY_PORT: string;
      BACKEND_LLM_BASE_URL: string;
      BACKEND_LLM_API_KEY: string;
      OLLAMA_BASE_URL?: string;
      OLLAMA_DEFAULT_CONTEXT_LENGTH: string;
      DEBUG_MODE: string;
      ENABLE_TOOL_REINJECTION: string;
      TOOL_REINJECTION_MESSAGE_COUNT: string;
      TOOL_REINJECTION_TOKEN_COUNT: string;
      TOOL_REINJECTION_TYPE: string;
      MAX_STREAM_BUFFER_SIZE: string;
      STREAM_CONNECTION_TIMEOUT: string;
  // Headers are hardcoded; env overrides are not used
  HTTP_REFERER?: string;
  X_TITLE?: string;
    }
  }
}