/**
 * Ollama API Types
 */

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

export interface OllamaRequest {
  model: string;
  prompt?: string; // For legacy format
  messages?: OllamaMessage[]; // For chat format
  stream?: boolean;
  format?: 'json';
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

export interface OllamaResponse {
  model: string;
  created_at: string;
  response?: string; // For generate endpoint
  message?: OllamaMessage; // For chat endpoint
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  template?: string;
  tool_calls?: unknown[];
}

export interface OllamaStreamResponse extends OllamaResponse {
  done: boolean;
}

export interface OllamaErrorResponse {
  error: string;
}

export interface OllamaModelInfo {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaShowResponse {
  license?: string;
  modelfile?: string;
  parameters?: string;
  template?: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
  model_info?: {
    [key: string]: unknown;
  };
}

export interface OllamaStreamChunk {
  model: string;
  created_at?: string;
  response?: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  tool_calls?: unknown[];
}