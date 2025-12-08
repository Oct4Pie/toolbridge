// Auto-generated OpenAI API types from live endpoints
// DO NOT EDIT - regenerate with: npm run generate:types
//
// Types generated from multiple API response variations to ensure optional fields are correctly inferred

export type { ModelsListResponse, Datum as Model } from './models-list.js';
export type {
  ChatCompletionResponse,
  Choice,
  Message,
  ToolCall,
  Function as ToolFunction,
  ReasoningDetail,
  Usage,
  CompletionTokensDetails
} from './chat-completion.js';
export type {
  ChatCompletionStreamChunk,
  Choice as StreamChoice,
  Delta,
  Usage as StreamUsage
} from './chat-completion-stream-chunk.js';
