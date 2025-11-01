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


import { converterRegistry } from '../converters/base.js';
import { OllamaConverter } from '../converters/ollama.js';
import { OpenAIConverter } from '../converters/openai-simple.js';
import { TranslationError } from '../types/generic.js';
import { createConversionContext } from '../utils/contextFactory.js';

import type { ProviderConverter } from '../converters/base.js';
import type {
  LLMProvider,
  GenericLLMRequest,
  ConversionContext,
  CompatibilityResult,
  ProviderCapabilities
} from '../types/index.js';

// Translation request options
export interface TranslationOptions {
  from: LLMProvider;
  to: LLMProvider;
  request: unknown;
  context?: Partial<ConversionContext>;
  strict?: boolean; // Fail on unsupported features vs graceful degradation
  preserveExtensions?: boolean;
}

// Translation result
export interface TranslationResult {
  success: boolean;
  data?: unknown;
  error?: TranslationError;
  compatibility: CompatibilityResult;
  context: ConversionContext;
  transformations: Array<{
    step: string;
    description: string;
    timestamp: number;
  }>;
}

// Streaming translation options
export interface StreamTranslationOptions extends TranslationOptions {
  sourceStream: ReadableStream<unknown>;
}

// Stream translation result
export interface StreamTranslationResult {
  success: boolean;
  stream?: ReadableStream<unknown>;
  error?: TranslationError;
  compatibility: CompatibilityResult;
  context: ConversionContext;
}

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
      // Check if direct conversion (same provider)
      if (options.from === options.to) {
        return {
          success: true,
          data: options.request,
          compatibility: { compatible: true, warnings: [], unsupportedFeatures: [], transformations: [] },
          context,
          transformations: []
        };
      }
      
      // Get converters
      const sourceConverter = this.getConverter(options.from);
      const targetConverter = this.getConverter(options.to);
      
      // Step 1: Convert to generic format
      const genericRequest = await sourceConverter.toGeneric(options.request, context);
      this.logStep(context, 'to_generic', `Converted ${options.from} request to generic format`);
      
      // Step 2: Check compatibility with target provider
      const compatibility = await targetConverter.checkCompatibility(genericRequest);
      
      if (!compatibility.compatible && (options.strict === true)) {
        throw new Error(`Incompatible features: ${compatibility.unsupportedFeatures.join(', ')}`);
      }
      
      // Step 3: Apply transformations for unsupported features
      const transformedRequest = this.applyTransformations(genericRequest, compatibility, context);
      
      // Step 4: Convert from generic to target format
      const targetRequest = await targetConverter.fromGeneric(transformedRequest, context);
      this.logStep(context, 'from_generic', `Converted generic request to ${options.to} format`);
      
      return {
        success: true,
        data: targetRequest,
        compatibility,
        context,
        transformations: context.transformationLog ?? []
      };
      
    } catch (error) {
      const translationError = error instanceof Error ? 
        new TranslationError(error.message, 'CONVERSION_FAILED', context, error) :
        new TranslationError('Unknown conversion error', 'CONVERSION_FAILED', context);
      
      return {
        success: false,
        error: translationError,
        compatibility: { compatible: false, warnings: [], unsupportedFeatures: [], transformations: [] },
        context,
        transformations: context.transformationLog ?? []
      };
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
        return {
          success: true,
          data: response,
          compatibility: { compatible: true, warnings: [], unsupportedFeatures: [], transformations: [] },
          context: ctx,
          transformations: []
        };
      }
      
      const sourceConverter = this.getConverter(from);
      const targetConverter = this.getConverter(to);
      
      // Convert response: provider → generic → provider
      const genericResponse = await sourceConverter.responseToGeneric(response, ctx);
      const targetResponse = await targetConverter.responseFromGeneric(genericResponse, ctx);
      
      return {
        success: true,
        data: targetResponse,
        compatibility: { compatible: true, warnings: [], unsupportedFeatures: [], transformations: [] },
        context: ctx,
        transformations: ctx.transformationLog ?? []
      };
      
    } catch (error) {
      const translationError = error instanceof Error ?
        new TranslationError(error.message, 'CONVERSION_FAILED', ctx, error) :
        new TranslationError('Unknown response conversion error', 'CONVERSION_FAILED', ctx);
        
      return {
        success: false,
        error: translationError,
        compatibility: { compatible: false, warnings: [], unsupportedFeatures: [], transformations: [] },
        context: ctx,
        transformations: ctx.transformationLog ?? []
      };
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
        return {
          success: true,
          stream: options.sourceStream,
          compatibility: { compatible: true, warnings: [], unsupportedFeatures: [], transformations: [] },
          context
        };
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
      
      return {
        success: true,
        stream: convertedStream,
        compatibility,
        context
      };
      
    } catch (error) {
      const translationError = error instanceof Error ?
        new TranslationError(error.message, 'CONVERSION_FAILED', context, error) :
        new TranslationError('Stream conversion error', 'CONVERSION_FAILED', context);
        
      return {
        success: false,
        error: translationError,
        compatibility: { compatible: false, warnings: [], unsupportedFeatures: [], transformations: [] },
        context
      };
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
  
  private applyTransformations(
    request: GenericLLMRequest, 
    compatibility: CompatibilityResult,
    context: ConversionContext
  ): GenericLLMRequest {
    let transformed = { ...request };
    
    // Apply each transformation
    for (const transformation of compatibility.transformations) {
      switch (transformation.from) {
        case 'tool_calls':
          // Convert tool calls to system instructions
          if (transformed.tools) {
            const instructions = this.convertToolsToInstructions(transformed.tools);
            transformed.messages.unshift({
              role: 'system',
              content: instructions
            });
            delete (transformed as Record<string, unknown>)['tools']; // Remove tools property
            this.logStep(context, 'transform_tools', 'Converted tool calls to system instructions');
          }
          break;
          
        case 'n > 1':
          // Force single choice
          transformed.n = 1;
          this.logStep(context, 'transform_choices', 'Limited to single choice response');
          break;
          
        case 'structured_outputs':
          // Convert structured outputs to JSON mode
          if (typeof transformed.responseFormat === 'object') {
            const responseFormat = transformed.responseFormat as { json_schema?: { schema?: unknown } };
            transformed.responseFormat = 'json_object';
            // Add schema instruction to system message
            const schemaInstruction = `Return response as JSON matching this schema: ${JSON.stringify(responseFormat?.json_schema?.schema ?? {})}`;
            transformed.messages.unshift({
              role: 'system', 
              content: schemaInstruction
            });
            this.logStep(context, 'transform_structured_output', 'Converted structured output to JSON mode with instructions');
          }
          break;
      }
    }
    
    return transformed;
  }
  
  private convertToolsToInstructions(tools: unknown[]): string {
    type ToolType = { function: { name: string; description?: string; parameters?: unknown } };
    const instructions = tools.map(tool => {
      const func = (tool as ToolType).function;
      return `Function: ${func.name}\nDescription: ${func.description ?? 'No description'}\nParameters: ${JSON.stringify(func.parameters ?? {})}`;
    }).join('\n\n');
    
    return `You have access to the following functions. When you need to use a function, respond with a JSON object containing the function name and parameters:\n\n${instructions}\n\nTo use a function, respond with: {"function": "function_name", "parameters": {...}}`;
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
