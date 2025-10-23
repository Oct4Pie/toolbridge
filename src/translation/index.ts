/**
 * Translation System - Main Export
 * 
 * Universal LLM translation system with generic schema intermediary
 * for any-to-any conversions between OpenAI, Azure, and Ollama.
 */

// Core translation engine
export { 
  TranslationEngine,
  translationEngine,
  translate,
  translateResponse,
  translateStream
} from './engine/translator.js';

export type {
  TranslationOptions,
  TranslationResult,
  StreamTranslationOptions,
  StreamTranslationResult
} from './engine/translator.js';

// Express router for HTTP API
export { default as translationRouter } from './engine/router.js';

// Provider converters
export { OpenAIConverter } from './converters/openai-simple.js';
export { AzureConverter } from './converters/azure.js';
export { OllamaConverter } from './converters/ollama.js';

export type { ProviderConverter } from './converters/base.js';
export { 
  BaseConverter, 
  ConverterRegistry, 
  converterRegistry,
  getConverter 
} from './converters/base.js';

// Types (re-export everything)
export * from './types/index.js';

// Convenience functions for common use cases

/**
 * Convert OpenAI request to Azure format
 */
export async function openaiToAzure(request: unknown, strict = false) {
  const { translate } = await import('./engine/translator.js');
  return translate({
    from: 'openai',
    to: 'azure', 
    request,
    strict
  });
}

/**
 * Convert Azure request to OpenAI format
 */
export async function azureToOpenai(request: unknown, strict = false) {
  const { translate } = await import('./engine/translator.js');
  return translate({
    from: 'azure',
    to: 'openai',
    request,
    strict
  });
}

/**
 * Convert OpenAI request to Ollama format
 */
export async function openaiToOllama(request: unknown, strict = false) {
  const { translate } = await import('./engine/translator.js');
  return translate({
    from: 'openai',
    to: 'ollama',
    request,
    strict
  });
}

/**
 * Convert Ollama request to OpenAI format
 */
export async function ollamaToOpenai(request: unknown, strict = false) {
  const { translate } = await import('./engine/translator.js');
  return translate({
    from: 'ollama',
    to: 'openai',
    request,
    strict
  });
}

/**
 * Convert Azure request to Ollama format
 */
export async function azureToOllama(request: unknown, strict = false) {
  const { translate } = await import('./engine/translator.js');
  return translate({
    from: 'azure',
    to: 'ollama',
    request,
    strict
  });
}

/**
 * Convert Ollama request to Azure format
 */
export async function ollamaToAzure(request: unknown, strict = false) {
  const { translate } = await import('./engine/translator.js');
  return translate({
    from: 'ollama',
    to: 'azure',
    request,
    strict
  });
}
