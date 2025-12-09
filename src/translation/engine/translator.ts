/**
 * Translation Engine - Universal LLM Request/Response Converter
 * 
 * This is the main orchestrator that enables any-to-any conversions between
 * OpenAI and Ollama through the generic schema intermediary.
 * 
 * Key Features:
 * - Any provider to any provider conversion
 * - Streaming support with real-time conversion
 * - Feature compatibility checking and graceful degradation
 * - Extensible architecture for adding new providers
 * - Comprehensive error handling and logging
 */


import { converterRegistry, type ProviderConverter } from '../converters/base.js';
import { OllamaConverter } from '../converters/ollama/index.js';
import { OpenAIConverter } from '../converters/openai-simple.js';
import { TranslationError } from '../types/generic.js';
import { createConversionContext } from '../utils/contextFactory.js';
import {
  createPassthroughResult,
  createSuccessResult,
  createErrorResult,
  createStreamPassthroughResult,
  createStreamSuccessResult,
  createStreamErrorResult,
} from '../utils/resultHelpers.js';
import { applyTransformations } from '../utils/transformationUtils.js';

import type {
  LLMProvider,
  ConversionContext,
  ProviderCapabilities
} from '../types/index.js';
import type {
  TranslationOptions,
  TranslationResult,
  StreamTranslationOptions,
  StreamTranslationResult,
} from '../types/translator.js';

// Re-export types for backwards compatibility
export type {
  TranslationOptions,
  TranslationResult,
  StreamTranslationOptions,
  StreamTranslationResult,
};

export class TranslationEngine {
  private readonly converters = new Map<LLMProvider, ProviderConverter>();
  
  constructor() {
    this.initializeConverters();
  }
  
  /**
   * Convert a request from one provider format to another
   */
  async convertRequest(options: TranslationOptions): Promise<TranslationResult> {
    const context = createConversionContext(options.from, options.to, options.context);

    try {
      // Get converters (needed even for same-provider to check compatibility and apply transformations)
      const sourceConverter = this.getConverter(options.from);
      const targetConverter = this.getConverter(options.to);

      // Step 1: Convert to generic format (ALWAYS, even for same provider)
      const genericRequest = await sourceConverter.toGeneric(options.request, context);
      this.logStep(context, 'to_generic', `Converted ${options.from} request to generic format`);

      // Step 2: Check compatibility with target provider
      const compatibility = await targetConverter.checkCompatibility(genericRequest);

      if (!compatibility.compatible && (options.strict === true)) {
        throw new Error(`Incompatible features: ${compatibility.unsupportedFeatures.join(', ')}`);
      }

      // Step 3: Apply transformations (CRITICAL: ALWAYS run this for passTools enforcement)
      // This ensures passTools=false strips tools even when source === target provider
      const transformedRequest = applyTransformations(genericRequest, compatibility, context, this.logStep.bind(this));

      // Step 4: Convert from generic to target format
      const targetRequest = await targetConverter.fromGeneric(transformedRequest, context);
      this.logStep(context, 'from_generic', `Converted generic request to ${options.to} format`);

      return createSuccessResult(targetRequest, compatibility, context);

    } catch (error) {
      return createErrorResult(error, context);
    }
  }
  
  /**
   * Convert a response from one provider format to another
   */
  async convertResponse(
    response: unknown,
    from: LLMProvider,
    to: LLMProvider,
    context?: Partial<ConversionContext>
  ): Promise<TranslationResult> {
    const ctx = createConversionContext(from, to, context);

    try {
      // Direct conversion for same provider
      if (from === to) {
        return createPassthroughResult(response, ctx);
      }

      const sourceConverter = this.getConverter(from);
      const targetConverter = this.getConverter(to);

      // Convert response: provider → generic → provider
      const genericResponse = await sourceConverter.responseToGeneric(response, ctx);
      const targetResponse = await targetConverter.responseFromGeneric(genericResponse, ctx);

      return createSuccessResult(
        targetResponse,
        { compatible: true, warnings: [], unsupportedFeatures: [], transformations: [] },
        ctx
      );

    } catch (error) {
      return createErrorResult(error, ctx);
    }
  }
  
  /**
   * Convert a streaming response in real-time
   */
  async convertStream(options: StreamTranslationOptions): Promise<StreamTranslationResult> {
    const context = createConversionContext(options.from, options.to, options.context);

    try {
      // Same provider - pass through
      if (options.from === options.to) {
        return createStreamPassthroughResult(options.sourceStream, context);
      }

      const sourceConverter = this.getConverter(options.from);
      const targetConverter = this.getConverter(options.to);

      // Convert options.request to generic format first to check compatibility
      const genericRequest = await sourceConverter.toGeneric(options.request, context);
      const compatibility = await targetConverter.checkCompatibility(genericRequest);

      // Create transform stream
      const transformStream = new TransformStream({
        transform: async (chunk, controller) => {
          try {
            // Convert chunk: source → generic → target
            const genericChunk = await sourceConverter.chunkToGeneric(chunk, context);
            if (genericChunk) {
              const targetChunk = await targetConverter.chunkFromGeneric(genericChunk, context);
              controller.enqueue(targetChunk);
            }
          } catch (error) {
            console.error('Stream conversion error:', error);
            controller.error(error);
          }
        }
      });

      const convertedStream = options.sourceStream.pipeThrough(transformStream);

      return createStreamSuccessResult(convertedStream, compatibility, context);

    } catch (error) {
      return createStreamErrorResult(error, context);
    }
  }
  
  /**
   * Convert a single stream chunk from one provider format to another
   *
   * This is the public API for stream processors to use instead of directly
   * accessing converter methods. Maintains SSOT by routing through the
   * translation engine.
   *
   * @param chunk - The chunk to convert (unknown format from source provider)
   * @param from - Source provider
   * @param to - Target provider
   * @param context - Conversion context (optional, will be created if not provided)
   * @returns The converted chunk in target format, or null if chunk should be skipped
   */
  async convertChunk(
    chunk: unknown,
    from: LLMProvider,
    to: LLMProvider,
    context?: ConversionContext
  ): Promise<unknown | null> {
    const ctx = context ?? createConversionContext(from, to);

    try {
      // Same provider - pass through
      if (from === to) {
        return chunk;
      }

      const sourceConverter = this.getConverter(from);
      const targetConverter = this.getConverter(to);

      // Convert: source → generic → target
      const genericChunk = await sourceConverter.chunkToGeneric(chunk, ctx);
      if (!genericChunk) {
        return null; // Chunk should be skipped
      }

      const targetChunk = await targetConverter.chunkFromGeneric(genericChunk, ctx);
      return targetChunk;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown chunk conversion error';
      throw new TranslationError(
        `Chunk conversion failed: ${errorMessage}`,
        'CHUNK_CONVERSION_FAILED',
        ctx,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get available providers
   */
  getAvailableProviders(): LLMProvider[] {
    return Array.from(this.converters.keys());
  }
  
  /**
   * Check if a provider is supported
   */
  isProviderSupported(provider: LLMProvider): boolean {
    return this.converters.has(provider);
  }
  
  /**
   * Get provider capabilities
   */
  getProviderCapabilities(provider: LLMProvider): ProviderCapabilities | null {
    const converter = this.converters.get(provider);
    return converter?.capabilities ?? null;
  }
  
  /**
   * Add or update a converter
   */
  registerConverter(converter: ProviderConverter): void {
    this.converters.set(converter.provider, converter);
    converterRegistry.register(converter);
  }
  
  /**
   * Remove a converter
   */
  unregisterConverter(provider: LLMProvider): boolean {
    converterRegistry.remove(provider);
    return this.converters.delete(provider);
  }
  
  // Private helper methods
  private initializeConverters(): void {
    const openaiConverter = new OpenAIConverter();
    const ollamaConverter = new OllamaConverter();

    this.registerConverter(openaiConverter);
    this.registerConverter(ollamaConverter);
  }
  
  private getConverter(provider: LLMProvider): ProviderConverter {
    const converter = this.converters.get(provider);
    if (!converter) {
      throw new Error(`No converter registered for provider: ${provider}`);
    }
    return converter;
  }
  
  private logStep(context: ConversionContext, step: string, description: string): void {
    if (context.transformationLog) {
      context.transformationLog.push({
        step,
        description,
        timestamp: Date.now()
      });
    }
  }
}

// Global translation engine instance
export const translationEngine = new TranslationEngine();

// Convenience functions for easy usage
export async function translate(options: TranslationOptions): Promise<TranslationResult> {
  return translationEngine.convertRequest(options);
}

export async function translateResponse(
  response: unknown,
  from: LLMProvider,
  to: LLMProvider,
  context?: Partial<ConversionContext>
): Promise<TranslationResult> {
  return translationEngine.convertResponse(response, from, to, context);
}

export async function translateStream(options: StreamTranslationOptions): Promise<StreamTranslationResult> {
  return translationEngine.convertStream(options);
}

/**
 * Convert a single stream chunk (convenience function for stream processors)
 *
 * This is the SSOT-compliant way for stream processors to convert chunks.
 * Use this instead of directly accessing converters.
 */
export async function translateChunk(
  chunk: unknown,
  from: LLMProvider,
  to: LLMProvider,
  context?: ConversionContext
): Promise<unknown | null> {
  return translationEngine.convertChunk(chunk, from, to, context);
}
