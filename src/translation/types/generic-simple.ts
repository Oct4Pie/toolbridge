/**
 * Generic Schema Types - Simplified Working Version
 * 
 * Universal LLM schema that can represent any provider's requests and responses.
 * This serves as the translation intermediary between all providers.
 */

// Core provider types
export type LLMProvider = 'openai' | 'ollama';

// Generic message content types
export type GenericMessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'function';

export interface GenericMessageContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: string };
}

export interface GenericMessage {
  role: GenericMessageRole;
  content: string | GenericMessageContentPart[];
  name?: string;
  tool_calls?: GenericToolCall[];
  tool_call_id?: string;
  refusal?: string;
}

// Tool calling interfaces
export interface GenericToolCall {
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface GenericTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// Usage tracking
export interface GenericUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// Request interface - supports all provider features
export interface GenericLLMRequest {
  // Core identification
  provider: LLMProvider;
  model: string;
  
  // Messages
  messages: GenericMessage[];
  
  // Generation parameters (normalized names)
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number; // Ollama specific
  repetitionPenalty?: number; // Ollama specific
  presencePenalty?: number;
  frequencyPenalty?: number;
  seed?: number;
  stop?: string | string[];
  
  // Advanced features
  tools?: GenericTool[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  parallelToolCalls?: boolean;
  responseFormat?: string | { type: string; json_schema?: unknown };
  
  // Streaming
  stream?: boolean;
  streamOptions?: {
    includeUsage?: boolean;
  };
  
  // Multiple choices
  n?: number;
  
  // Other parameters
  logitBias?: Record<string, number>;
  logprobs?: boolean;
  topLogprobs?: number;
  
  // Provider-specific extensions
  extensions?: {
    openai?: unknown;
    ollama?: unknown;
  };
}

// Response interface
export interface GenericLLMResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  provider: LLMProvider;
  choices: Array<Record<string, unknown>>;
  usage?: GenericUsage;
  systemFingerprint?: string;
  extensions?: {
    openai?: Record<string, unknown>;
    ollama?: Record<string, unknown>;
  };
}

// Streaming chunk interface
export interface GenericStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  provider: LLMProvider;
  choices: Array<Record<string, unknown>>;
  usage?: GenericUsage;
}

// Compatibility and transformation types
export interface CompatibilityResult {
  compatible: boolean;
  warnings: string[];
  unsupportedFeatures: string[];
  transformations: Array<{
    from: string;
    to: string;
    description: string;
  }>;
}

// Conversion context
export interface ConversionContext {
  sourceProvider: LLMProvider;
  targetProvider: LLMProvider;
  requestId: string;
  preserveExtensions?: boolean;
  strictMode?: boolean;
  transformationLog?: Array<{
    step: string;
    description: string;
    timestamp: number;
  }>;
}

// Error types
export class TranslationError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: ConversionContext,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

// Provider capabilities
export interface ProviderCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  jsonMode: boolean;
  structuredOutputs: boolean;
  multipleChoices: boolean;
  imageInputs: boolean;
  customParameters: string[];
  maxTokens?: number;
  models?: string[];
}
