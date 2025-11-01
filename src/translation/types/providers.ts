/**
 * Provider-specific types and mappings
 * 
 * This file defines the specific types and configurations for each
 * supported LLM provider, including their capabilities and parameter mappings.
 */

import type { ProviderCapabilities, LLMProvider } from './generic.js';

// OpenAI specific types (importing from existing types)
export interface OpenAIProviderConfig {
  baseUrl: string;
  apiKey: string;
  organization?: string;
  defaultModel?: string;
  timeout?: number;
}

// Ollama specific types
export interface OllamaProviderConfig {
  baseUrl: string;
  defaultModel?: string;
  timeout?: number;
  pullModels?: boolean; // Auto-pull missing models
}

// Provider configuration union
export type ProviderConfig = {
  openai: OpenAIProviderConfig;
  ollama: OllamaProviderConfig;
};

// Parameter mapping between generic and provider-specific names
export interface ParameterMapping {
  [genericName: string]: {
    openai?: string;
    ollama?: string;
    defaultValue?: unknown;
    validator?: (value: unknown) => boolean;
    transformer?: (value: unknown, targetProvider: LLMProvider) => unknown;
  };
}

// Default parameter mappings
export const PARAMETER_MAPPINGS: ParameterMapping = {
  maxTokens: {
    openai: 'max_tokens',
    ollama: 'num_predict',
  },
  temperature: {
    openai: 'temperature',
    ollama: 'temperature',
    validator: (value: unknown): boolean => typeof value === 'number' && value >= 0 && value <= 2,
  },
  topP: {
    openai: 'top_p',
    ollama: 'top_p',
    validator: (value: unknown): boolean => typeof value === 'number' && value >= 0 && value <= 1,
  },
  topK: {
    ollama: 'top_k',
    validator: (value: unknown): boolean => typeof value === 'number' && value >= 1,
  },
  presencePenalty: {
    openai: 'presence_penalty',
    validator: (value: unknown): boolean => typeof value === 'number' && value >= -2 && value <= 2,
  },
  frequencyPenalty: {
    openai: 'frequency_penalty',
    validator: (value: unknown): boolean => typeof value === 'number' && value >= -2 && value <= 2,
  },
  repetitionPenalty: {
    ollama: 'repeat_penalty',
    transformer: (value: unknown, targetProvider: LLMProvider): unknown => {
      // Convert from OpenAI-style (-2 to 2) to Ollama-style (0.1 to 2.0)
      if (typeof value === 'number' && targetProvider === 'ollama' && value !== undefined) {
        return Math.max(0.1, Math.min(2.0, 1 + value / 2));
      }
      return value;
    },
  },
  seed: {
    openai: 'seed',
    ollama: 'seed',
    validator: (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value),
  },
  stop: {
    openai: 'stop',
    ollama: 'stop',
  },
  stream: {
    openai: 'stream',
    ollama: 'stream',
  },
};

// Provider capabilities definitions
export const PROVIDER_CAPABILITIES: Record<LLMProvider, ProviderCapabilities> = {
  openai: {
    streaming: true,
    toolCalls: true,
    functionCalls: true, // Legacy support
    multipleChoices: true,
    logprobs: true,
    jsonMode: true,
    structuredOutputs: true,
    imageInputs: true,
    audioInputs: true,
    seedSupport: true,
    parallelToolCalls: true,
    customParameters: [
      'user', 'logit_bias', 'logprobs', 'top_logprobs', 'n', 'best_of',
      'presence_penalty', 'frequency_penalty', 'response_format'
    ],
  },
  ollama: {
    streaming: true,
    toolCalls: true,
    functionCalls: true,
    multipleChoices: false,
    logprobs: false,
    jsonMode: true,
    structuredOutputs: false,
    imageInputs: true, // Model dependent
    audioInputs: false,
    seedSupport: true,
    parallelToolCalls: false,
    customParameters: [
      'num_predict', 'num_ctx', 'repeat_penalty', 'top_k',
      'mirostat', 'mirostat_eta', 'mirostat_tau', 'tfs_z',
      'keep_alive'
    ],
  },
};

// Model mappings between providers
export interface ModelMapping {
  generic: string; // Generic model name
  openai?: string;
  ollama?: string[];
  aliases?: string[]; // Alternative names
  capabilities?: Partial<ProviderCapabilities>; // Model-specific overrides
}

// Common model mappings
export const MODEL_MAPPINGS: ModelMapping[] = [
  {
    generic: 'gpt-4o',
    openai: 'gpt-4o',
    aliases: ['gpt4o', 'gpt-4-omni'],
  },
  {
    generic: 'gpt-4o-mini',
    openai: 'gpt-4o-mini',
    aliases: ['gpt4o-mini'],
  },
  {
    generic: 'gpt-4-turbo',
    openai: 'gpt-4-turbo',
  },
  {
    generic: 'gpt-3.5-turbo',
    openai: 'gpt-3.5-turbo',
  },
  {
    generic: 'llama3.1',
    ollama: ['llama3.1:8b', 'llama3.1:70b', 'llama3.1:405b'],
    capabilities: {
      toolCalls: false,
      structuredOutputs: false,
    },
  },
  {
    generic: 'llama3.2',
    ollama: ['llama3.2:1b', 'llama3.2:3b', 'llama3.2:11b', 'llama3.2:90b'],
  },
  {
    generic: 'codellama',
    ollama: ['codellama:7b', 'codellama:13b', 'codellama:34b'],
  },
  {
    generic: 'mistral',
    ollama: ['mistral:7b', 'mistral:latest'],
  },
];

// Feature compatibility matrix
export interface FeatureCompatibility {
  from: LLMProvider;
  to: LLMProvider;
  features: {
    [feature: string]: {
      supported: boolean;
      transformation?: string;
      fallback?: unknown;
      warning?: string;
    };
  };
}

// Compatibility rules between providers
export const COMPATIBILITY_MATRIX: FeatureCompatibility[] = [
  {
    from: 'openai',
    to: 'ollama',
    features: {
      toolCalls: { 
        supported: false, 
        fallback: null,
        warning: 'Tool calls will be converted to text instructions'
      },
      streaming: { supported: true },
      jsonMode: { supported: true },
      multipleChoices: { 
        supported: false,
        fallback: 1,
        warning: 'Multiple choices not supported, using n=1'
      },
      logprobs: { 
        supported: false,
        warning: 'Log probabilities not available in Ollama'
      },
      structuredOutputs: { 
        supported: false,
        transformation: 'Convert to JSON mode with instructions'
      },
    },
  },
  {
    from: 'ollama',
    to: 'openai',
    features: {
      streaming: { supported: true },
      jsonMode: { supported: true },
      customParameters: {
        supported: false,
        warning: 'Ollama-specific parameters will be ignored'
      },
    },
  },
];

// Provider endpoint patterns
export interface EndpointPattern {
  pattern: RegExp;
  provider: LLMProvider;
  extractModel?: (path: string) => string | null;
}

export const ENDPOINT_PATTERNS: EndpointPattern[] = [
  // OpenAI patterns
  {
    pattern: /^\/v1\/chat\/completions$/,
    provider: 'openai',
  },
  {
    pattern: /^\/v1\/completions$/,
    provider: 'openai',
  },
  // Ollama patterns
  {
    pattern: /^\/api\/chat$/,
    provider: 'ollama',
  },
  {
    pattern: /^\/api\/generate$/,
    provider: 'ollama',
  },
  {
    pattern: /^\/v1\/chat\/completions$/,
    provider: 'ollama', // Ollama OpenAI compatibility
  },
];

// Export provider registry
export interface ProviderRegistry {
  [key: string]: {
    config: ProviderConfig[keyof ProviderConfig];
    capabilities: ProviderCapabilities;
    endpoints: EndpointPattern[];
  };
}

export * from './generic.js';
