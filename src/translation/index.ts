/**
 * Translation System - Main Export
 * 
 * Universal LLM translation system with generic schema intermediary
 * for any-to-any conversions between OpenAI and Ollama.
 */

// Core translation engine
export {
  TranslationEngine,
  translationEngine,
  translate,
  translateResponse,
  translateStream,
  translateChunk
} from './engine/translator.js';

export type {
  TranslationOptions,
  TranslationResult,
  StreamTranslationOptions,
  StreamTranslationResult
} from './engine/translator.js';

// Provider converters
export { OpenAIConverter } from './converters/openai-simple.js';
export { OllamaConverter } from './converters/ollama/index.js';

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
