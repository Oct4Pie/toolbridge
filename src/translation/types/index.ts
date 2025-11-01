/**
 * Translation Types - Main exports
 * 
 * Central export point for all translation-related types
 */

// Re-export all generic types
export * from './generic.js';

// Re-export all provider-specific types
export * from './providers.js';

// Convenience type exports
export type {
  // Core types
  LLMProvider,
  GenericLLMRequest,
  GenericLLMResponse,
  GenericStreamChunk,
  GenericMessage,
  GenericTool,
  GenericToolCall,
  
  // Compatibility types
  CompatibilityResult,
  ConversionContext,
  
  // Capabilities
  ProviderCapabilities,
  
  // Error types
  TranslationError,
  UnsupportedFeatureError,
} from './generic.js';

export type {
  // Provider configs
  OpenAIProviderConfig,
  OllamaProviderConfig,
  ProviderConfig,
  
  // Mappings
  ParameterMapping,
  ModelMapping,
  FeatureCompatibility,
  
  // Registry
  ProviderRegistry,
  EndpointPattern,
} from './providers.js';
