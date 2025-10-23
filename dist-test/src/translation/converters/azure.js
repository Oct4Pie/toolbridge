/**
 * Azure Provider Converter
 *
 * Handles conversion between Azure OpenAI API format and the generic schema.
 */
import { BaseConverter } from './base.js';
import { PROVIDER_CAPABILITIES, MODEL_MAPPINGS } from '../types/providers.js';
export class AzureConverter extends BaseConverter {
    provider = 'azure';
    capabilities = PROVIDER_CAPABILITIES.azure;
    // Request conversion: Azure → Generic
    async toGeneric(request, _context) {
        const genericRequest = {
            provider: 'azure',
            model: request.model || 'gpt-4o', // Azure uses deployments, not models
            deployment: this.extractDeploymentFromRequest(request),
            messages: request.messages || [],
            maxTokens: request.max_tokens,
            temperature: request.temperature,
            topP: request.top_p,
            presencePenalty: request.presence_penalty,
            frequencyPenalty: request.frequency_penalty,
            seed: request.seed,
            stop: request.stop,
            tools: request.tools,
            toolChoice: request.tool_choice,
            parallelToolCalls: request.parallel_tool_calls,
            responseFormat: request.response_format?.type || request.response_format,
            stream: request.stream,
            streamOptions: request.stream_options,
            n: request.n,
            // Azure-specific extensions
            extensions: {
                azure: {
                    dataSources: request.dataSources || request.data_sources,
                    enhancements: request.enhancements,
                }
            }
        };
        return genericRequest;
    }
    // Request conversion: Generic → Azure
    async fromGeneric(request, _context) {
        const azureRequest = {
            // Azure typically omits the model field, uses deployment in URL
            messages: request.messages,
            max_tokens: request.maxTokens,
            temperature: request.temperature,
            top_p: request.topP,
            presence_penalty: request.presencePenalty,
            frequency_penalty: request.frequencyPenalty,
            seed: request.seed,
            stop: request.stop,
            tools: request.tools,
            tool_choice: request.toolChoice,
            parallel_tool_calls: request.parallelToolCalls,
            stream: request.stream,
            n: request.n,
        };
        // Handle Azure-specific features
        if (request.extensions?.azure) {
            if (request.extensions.azure.dataSources) {
                azureRequest.dataSources = request.extensions.azure.dataSources;
            }
            if (request.extensions.azure.enhancements) {
                azureRequest.enhancements = request.extensions.azure.enhancements;
            }
        }
        // Handle response format
        if (request.responseFormat) {
            if (typeof request.responseFormat === 'string') {
                azureRequest.response_format = { type: request.responseFormat };
            }
            else {
                azureRequest.response_format = request.responseFormat;
            }
        }
        // Handle stream options
        if (request.streamOptions) {
            azureRequest.stream_options = {
                include_usage: request.streamOptions.includeUsage
            };
        }
        // Remove undefined values
        Object.keys(azureRequest).forEach(key => {
            if (azureRequest[key] === undefined) {
                delete azureRequest[key];
            }
        });
        return azureRequest;
    }
    // Response conversion: Azure → Generic
    async responseToGeneric(response, _context) {
        const genericResponse = {
            id: response.id,
            object: response.object,
            created: response.created,
            model: response.model,
            provider: 'azure',
            choices: response.choices || [],
            usage: response.usage ? {
                promptTokens: response.usage.prompt_tokens || 0,
                completionTokens: response.usage.completion_tokens || 0,
                totalTokens: response.usage.total_tokens || 0,
            } : undefined,
            systemFingerprint: response.system_fingerprint,
            extensions: {
                azure: {
                // Azure-specific response data
                }
            }
        };
        return genericResponse;
    }
    // Response conversion: Generic → Azure
    async responseFromGeneric(response, _context) {
        const azureResponse = {
            id: response.id,
            object: 'chat.completion',
            created: response.created,
            model: response.model,
            choices: response.choices,
            usage: response.usage ? {
                prompt_tokens: response.usage.promptTokens,
                completion_tokens: response.usage.completionTokens,
                total_tokens: response.usage.totalTokens,
            } : undefined,
            system_fingerprint: response.systemFingerprint,
        };
        return azureResponse;
    }
    // Stream chunk conversion: Azure → Generic
    async chunkToGeneric(chunk, _context) {
        if (!chunk || typeof chunk !== 'object')
            return null;
        const genericChunk = {
            id: chunk.id,
            object: 'chat.completion.chunk',
            created: chunk.created,
            model: chunk.model,
            provider: 'azure',
            choices: chunk.choices || [],
            usage: chunk.usage ? {
                promptTokens: chunk.usage.prompt_tokens || 0,
                completionTokens: chunk.usage.completion_tokens || 0,
                totalTokens: chunk.usage.total_tokens || 0
            } : undefined
        };
        return genericChunk;
    }
    // Stream chunk conversion: Generic → Azure
    async chunkFromGeneric(chunk, _context) {
        const azureChunk = {
            id: chunk.id,
            object: 'chat.completion.chunk',
            created: chunk.created,
            model: chunk.model,
            choices: chunk.choices,
            usage: chunk.usage ? {
                prompt_tokens: chunk.usage.promptTokens,
                completion_tokens: chunk.usage.completionTokens,
                total_tokens: chunk.usage.totalTokens
            } : undefined
        };
        return azureChunk;
    }
    // Model resolution for Azure (deployment-based)
    async resolveModel(model) {
        // Azure uses deployment names instead of models
        // This would typically integrate with ARM API to resolve deployments
        const mapping = MODEL_MAPPINGS.find(m => m.generic === model);
        if (mapping?.azure && mapping.azure.length > 0) {
            return mapping.azure[0]; // Return first deployment
        }
        return model; // Fallback to using as deployment name
    }
    async normalizeModel(deploymentOrModel) {
        // Try to find which generic model this deployment represents
        const mapping = MODEL_MAPPINGS.find(m => m.azure?.includes(deploymentOrModel) ||
            m.generic === deploymentOrModel);
        if (mapping) {
            return mapping.generic;
        }
        return deploymentOrModel;
    }
    // Helper method to extract deployment from request context
    extractDeploymentFromRequest(request) {
        // This would typically be extracted from the URL path
        // For now, use model field or a default
        return request.deployment || request.model;
    }
}
