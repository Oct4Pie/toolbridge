/**
 * Translation Engine - Universal LLM Request/Response Converter
 *
 * This is the main orchestrator that enables any-to-any conversions between
 * OpenAI, Azure, and Ollama through the generic schema intermediary.
 *
 * Key Features:
 * - Any provider to any provider conversion
 * - Streaming support with real-time conversion
 * - Feature compatibility checking and graceful degradation
 * - Extensible architecture for adding new providers
 * - Comprehensive error handling and logging
 */
import { TranslationError } from '../types/generic.js';
import { converterRegistry } from '../converters/base.js';
import { OpenAIConverter } from '../converters/openai-simple.js';
import { AzureConverter } from '../converters/azure.js';
import { OllamaConverter } from '../converters/ollama.js';
export class TranslationEngine {
    converters = new Map();
    constructor() {
        this.initializeConverters();
    }
    /**
     * Convert a request from one provider format to another
     */
    async convertRequest(options) {
        const context = this.createContext(options);
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
            if (!compatibility.compatible && options.strict) {
                throw new Error(`Incompatible features: ${compatibility.unsupportedFeatures.join(', ')}`);
            }
            // Step 3: Apply transformations for unsupported features
            const transformedRequest = await this.applyTransformations(genericRequest, compatibility, context);
            // Step 4: Convert from generic to target format
            const targetRequest = await targetConverter.fromGeneric(transformedRequest, context);
            this.logStep(context, 'from_generic', `Converted generic request to ${options.to} format`);
            return {
                success: true,
                data: targetRequest,
                compatibility,
                context,
                transformations: context.transformationLog || []
            };
        }
        catch (error) {
            const translationError = error instanceof Error ?
                new TranslationError(error.message, 'CONVERSION_FAILED', context, error) :
                new TranslationError('Unknown conversion error', 'CONVERSION_FAILED', context);
            return {
                success: false,
                error: translationError,
                compatibility: { compatible: false, warnings: [], unsupportedFeatures: [], transformations: [] },
                context,
                transformations: context.transformationLog || []
            };
        }
    }
    /**
     * Convert a response from one provider format to another
     */
    async convertResponse(response, from, to, context) {
        const ctx = context ?? this.createContext({ from, to, request: response });
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
                transformations: ctx.transformationLog || []
            };
        }
        catch (error) {
            const translationError = error instanceof Error ?
                new TranslationError(error.message, 'CONVERSION_FAILED', ctx, error) :
                new TranslationError('Unknown response conversion error', 'CONVERSION_FAILED', ctx);
            return {
                success: false,
                error: translationError,
                compatibility: { compatible: false, warnings: [], unsupportedFeatures: [], transformations: [] },
                context: ctx,
                transformations: ctx.transformationLog || []
            };
        }
    }
    /**
     * Convert a streaming response in real-time
     */
    async convertStream(options) {
        const context = this.createContext(options);
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
            // Check compatibility
            const compatibility = await targetConverter.checkCompatibility(options.request);
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
                    }
                    catch (error) {
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
        }
        catch (error) {
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
    getAvailableProviders() {
        return Array.from(this.converters.keys());
    }
    /**
     * Check if a provider is supported
     */
    isProviderSupported(provider) {
        return this.converters.has(provider);
    }
    /**
     * Get provider capabilities
     */
    getProviderCapabilities(provider) {
        const converter = this.converters.get(provider);
        return converter?.capabilities ?? null;
    }
    /**
     * Add or update a converter
     */
    registerConverter(converter) {
        this.converters.set(converter.provider, converter);
        converterRegistry.register(converter);
    }
    /**
     * Remove a converter
     */
    unregisterConverter(provider) {
        converterRegistry.remove(provider);
        return this.converters.delete(provider);
    }
    // Private helper methods
    initializeConverters() {
        const openaiConverter = new OpenAIConverter();
        const azureConverter = new AzureConverter();
        const ollamaConverter = new OllamaConverter();
        this.registerConverter(openaiConverter);
        this.registerConverter(azureConverter);
        this.registerConverter(ollamaConverter);
    }
    getConverter(provider) {
        const converter = this.converters.get(provider);
        if (!converter) {
            throw new Error(`No converter registered for provider: ${provider}`);
        }
        return converter;
    }
    createContext(options) {
        return {
            sourceProvider: options.from,
            targetProvider: options.to,
            requestId: Math.random().toString(36).substr(2, 9),
            preserveExtensions: options.context?.preserveExtensions ?? true,
            strictMode: options.context?.strictMode ?? false,
            transformationLog: []
        };
    }
    logStep(context, step, description) {
        if (context.transformationLog) {
            context.transformationLog.push({
                step,
                description,
                timestamp: Date.now()
            });
        }
    }
    async applyTransformations(request, compatibility, context) {
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
                        delete transformed.tools; // Remove tools property
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
                        transformed.responseFormat = 'json_object';
                        // Add schema instruction to system message
                        const schemaInstruction = `Return response as JSON matching this schema: ${JSON.stringify(transformed.responseFormat?.json_schema?.schema || {})}`;
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
    convertToolsToInstructions(tools) {
        const instructions = tools.map(tool => {
            const func = tool.function;
            return `Function: ${func.name}\nDescription: ${func.description || 'No description'}\nParameters: ${JSON.stringify(func.parameters || {})}`;
        }).join('\n\n');
        return `You have access to the following functions. When you need to use a function, respond with a JSON object containing the function name and parameters:\n\n${instructions}\n\nTo use a function, respond with: {"function": "function_name", "parameters": {...}}`;
    }
}
// Global translation engine instance
export const translationEngine = new TranslationEngine();
// Convenience functions for easy usage
export async function translate(options) {
    return translationEngine.convertRequest(options);
}
export async function translateResponse(response, from, to) {
    return translationEngine.convertResponse(response, from, to);
}
export async function translateStream(options) {
    return translationEngine.convertStream(options);
}
