/**
 * Generic LLM Schema - Universal format for cross-provider translation
 * 
 * This schema serves as the intermediary format that can represent requests
 * and responses from OpenAI and Ollama providers.
 * Each provider converter translates to/from this generic format.
 */

// Provider types
export type LLMProvider = 'openai' | 'ollama';

// Message roles - universal across providers
export type GenericMessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'function';

// Generic tool definition - compatible with all providers
export interface GenericTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean; // OpenAI structured outputs
  };
}

// Generic tool call - universal format
export interface GenericToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

// Generic message content - supports all content types
export type GenericMessageContent =
  | string
  | Array<{
    type: 'text' | 'image_url' | 'image_file';
    text?: string;
    image_url?: {
      url: string;
      detail?: 'low' | 'high' | 'auto';
    };
    image_file?: {
      file_id: string;
      detail?: 'low' | 'high' | 'auto';
    };
  }>;

// Generic message - universal format
export interface GenericMessage {
  role: GenericMessageRole;
  content?: GenericMessageContent;
  name?: string; // For function/tool messages
  tool_calls?: GenericToolCall[]; // For assistant messages with tool calls
  tool_call_id?: string; // For tool response messages
  refusal?: string; // For refused responses
}

// Generic response format specification
export type GenericResponseFormat =
  | 'text'
  | 'json_object'
  | {
    type: 'json_schema';
    json_schema: {
      name: string;
      description?: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    };
  };

// Generic tool choice options
export type GenericToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | {
    type: 'function';
    function: { name: string };
  };

// Generic LLM Request - universal format
export interface GenericLLMRequest {
  // Provider identification
  provider: LLMProvider;
  model: string;

  // Core conversation
  messages: GenericMessage[];

  // Generation parameters (normalized names)
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number; // For providers that support it
  presencePenalty?: number;
  frequencyPenalty?: number;
  repetitionPenalty?: number; // For Ollama
  seed?: number;
  stop?: string | string[];

  // Tool calling
  tools?: GenericTool[];
  toolChoice?: GenericToolChoice;
  parallelToolCalls?: boolean;

  // Response format
  responseFormat?: GenericResponseFormat;

  // Streaming
  stream?: boolean;
  streamOptions?: {
    includeUsage?: boolean;
  };

  // Advanced options
  logitBias?: Record<string, number>;
  logprobs?: boolean;
  topLogprobs?: number;
  n?: number; // Number of completions
  bestOf?: number; // For best-of sampling

  // Provider-specific extensions
  extensions?: {
    ollama?: {
      numPredict?: number;
      numCtx?: number;
      mirostat?: number;
      mirostatEta?: number;
      mirostatTau?: number;
      tfsZ?: number;
      keepAlive?: string;
    };
    openai?: {
      user?: string;
      functionCall?: unknown; // Legacy function calling
    };
    [key: string]: unknown;
  };

  // Metadata
  metadata?: {
    requestId?: string;
    userId?: string;
    sessionId?: string;
    tags?: string[];
  };
}

// Generic usage information
export interface GenericUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptTokensDetails?: {
    cachedTokens?: number;
  };
  completionTokensDetails?: {
    reasoningTokens?: number;
    acceptedPredictionTokens?: number;
    rejectedPredictionTokens?: number;
  };
}

// Generic choice in response
export interface GenericChoice {
  index: number;
  message: GenericMessage;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
  logprobs?: {
    content: Array<{
      token: string;
      logprob: number;
      bytes?: number[];
      topLogprobs?: Array<{
        token: string;
        logprob: number;
        bytes?: number[];
      }>;
    }> | null;
    refusal?: Array<{
      token: string;
      logprob: number;
      bytes?: number[];
      topLogprobs?: Array<{
        token: string;
        logprob: number;
        bytes?: number[];
      }>;
    }> | null;
  };
}

// Generic LLM Response - universal format
export interface GenericLLMResponse {
  id: string;
  object: 'chat.completion' | 'completion';
  created: number;
  model: string;
  provider: LLMProvider;

  choices: GenericChoice[];
  usage?: GenericUsage;

  // Provider-specific fields
  systemFingerprint?: string;

  // Extensions for provider-specific data
  extensions?: {
    ollama?: unknown;
    openai?: unknown;
    [key: string]: unknown;
  };
}

// Generic streaming chunk
export interface GenericStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  provider: LLMProvider;

  choices: Array<{
    index: number;
    delta: {
      role?: GenericMessageRole;
      content?: string | null; // Can be null per OpenAI spec
      tool_calls?: Array<{
        index?: number; // Optional to match OpenAI spec
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
      refusal?: string;
    };
    finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
    logprobs?: unknown;
  }>;

  usage?: GenericUsage; // Final chunk only

  // Extensions
  extensions?: {
    [provider: string]: unknown;
  };
}

// Provider capabilities - what each provider supports
export interface ProviderCapabilities {
  streaming: boolean;
  toolCalls: boolean;
  functionCalls: boolean; // Legacy
  multipleChoices: boolean;
  logprobs: boolean;
  jsonMode: boolean;
  structuredOutputs: boolean;
  imageInputs: boolean;
  audioInputs: boolean;
  seedSupport: boolean;
  parallelToolCalls: boolean;
  customParameters: string[]; // List of custom parameter names
}

// Feature compatibility result
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

// Conversion context - metadata for conversions
export interface ConversionContext {
  sourceProvider: LLMProvider;
  targetProvider: LLMProvider;
  requestId?: string;
  preserveExtensions?: boolean;
  strictMode?: boolean; // Fail on unsupported features vs warn
  
  // Tool calling context
  knownToolNames?: string[]; // For XML tool call parsing
  enableXMLToolParsing?: boolean; // Enable XML-based tool call detection
  
  transformationLog?: Array<{
    step: string;
    description: string;
    timestamp: number;
  }>;
}

// Error types for translation
export class TranslationError extends Error {
  constructor(
    message: string,
    public code: 'UNSUPPORTED_FEATURE' | 'INVALID_REQUEST' | 'CONVERSION_FAILED' | 'PROVIDER_ERROR',
    public context?: ConversionContext,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

export class UnsupportedFeatureError extends TranslationError {
  constructor(feature: string, provider: LLMProvider, context?: ConversionContext) {
    super(
      `Feature '${feature}' is not supported by provider '${provider}'`,
      'UNSUPPORTED_FEATURE',
      context
    );
  }
}

// All types are exported inline above
