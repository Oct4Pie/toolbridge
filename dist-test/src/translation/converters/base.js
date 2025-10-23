/**
 * Base Provider Converter Interface
 *
 * Defines the contract that all provider converters must implement
 * for bidirectional conversion to/from the generic schema.
 */
// Abstract base class with common functionality
export class BaseConverter {
    // Default implementations
    async validateRequest(request) {
        const errors = [];
        // Basic validation
        if (!request) {
            errors.push('Request is null or undefined');
            return { valid: false, errors };
        }
        if (!request.messages || !Array.isArray(request.messages)) {
            errors.push('Messages array is required');
        }
        if (request.messages?.length === 0) {
            errors.push('At least one message is required');
        }
        return { valid: errors.length === 0, errors };
    }
    async checkCompatibility(request) {
        const warnings = [];
        const unsupportedFeatures = [];
        const transformations = [];
        // Check tool calls support
        if (request.tools && !this.capabilities.toolCalls) {
            unsupportedFeatures.push('toolCalls');
            transformations.push({
                from: 'tool_calls',
                to: 'text_instructions',
                description: 'Tool calls will be converted to text instructions'
            });
        }
        // Check streaming support
        if (request.stream && !this.capabilities.streaming) {
            unsupportedFeatures.push('streaming');
            warnings.push('Streaming not supported, will return complete response');
        }
        // Check multiple choices
        if (request.n && request.n > 1 && !this.capabilities.multipleChoices) {
            unsupportedFeatures.push('multipleChoices');
            transformations.push({
                from: 'n > 1',
                to: 'n = 1',
                description: 'Multiple choices not supported, using single response'
            });
        }
        // Check logprobs
        if (request.logprobs && !this.capabilities.logprobs) {
            unsupportedFeatures.push('logprobs');
            warnings.push('Log probabilities not available for this provider');
        }
        // Check JSON mode
        if (request.responseFormat && request.responseFormat !== 'text' && !this.capabilities.jsonMode) {
            unsupportedFeatures.push('jsonMode');
            warnings.push('JSON response format not supported, using text mode');
        }
        // Check structured outputs
        if (request.responseFormat && typeof request.responseFormat === 'object' && !this.capabilities.structuredOutputs) {
            unsupportedFeatures.push('structuredOutputs');
            transformations.push({
                from: 'structured_outputs',
                to: 'json_mode',
                description: 'Structured outputs converted to JSON mode with instructions'
            });
        }
        return {
            compatible: unsupportedFeatures.length === 0,
            warnings,
            unsupportedFeatures,
            transformations
        };
    }
    // Utility methods for common operations
    createContext(sourceProvider, targetProvider) {
        return {
            sourceProvider,
            targetProvider: targetProvider ?? this.provider,
            requestId: Math.random().toString(36).substr(2, 9),
            transformationLog: []
        };
    }
    logTransformation(context, step, description) {
        if (context.transformationLog) {
            context.transformationLog.push({
                step,
                description,
                timestamp: Date.now()
            });
        }
    }
    extractModelFromRequest(request) {
        return request?.model ?? request?.deployment ?? null;
    }
    generateId(prefix = 'chatcmpl') {
        const timestamp = Math.floor(Date.now() / 1000);
        const random = Math.random().toString(36).substr(2, 12);
        return `${prefix}-${timestamp}-${random}`;
    }
    getCurrentTimestamp() {
        return Math.floor(Date.now() / 1000);
    }
    // Parameter transformation utilities
    transformParameters(params, _direction) {
        // Override in subclasses for provider-specific parameter mapping
        return params;
    }
    mapParameters(params, mapping, direction) {
        const result = {};
        if (direction === 'toGeneric') {
            // Map provider-specific names to generic names
            for (const [providerKey, value] of Object.entries(params)) {
                const genericKey = Object.keys(mapping).find(k => mapping[k] === providerKey);
                if (genericKey) {
                    result[genericKey] = value;
                }
                else {
                    result[providerKey] = value; // Keep unmapped parameters
                }
            }
        }
        else {
            // Map generic names to provider-specific names
            for (const [genericKey, value] of Object.entries(params)) {
                const providerKey = mapping[genericKey];
                if (providerKey) {
                    result[providerKey] = value;
                }
                else {
                    result[genericKey] = value; // Keep unmapped parameters
                }
            }
        }
        return result;
    }
}
// Registry for storing converter instances
export class ConverterRegistry {
    converters = new Map();
    register(converter) {
        this.converters.set(converter.provider, converter);
    }
    get(provider) {
        return this.converters.get(provider) ?? null;
    }
    getAll() {
        return new Map(this.converters);
    }
    has(provider) {
        return this.converters.has(provider);
    }
    remove(provider) {
        return this.converters.delete(provider);
    }
    clear() {
        this.converters.clear();
    }
    getAvailableProviders() {
        return Array.from(this.converters.keys());
    }
}
// Global converter registry instance
export const converterRegistry = new ConverterRegistry();
// Utility function to get converter safely
export function getConverter(provider) {
    const converter = converterRegistry.get(provider);
    if (!converter) {
        throw new Error(`No converter registered for provider: ${provider}`);
    }
    return converter;
}
