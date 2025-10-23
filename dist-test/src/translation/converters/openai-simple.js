/**
 * OpenAI Provider Converter - Simplified Version
 *
 * Handles conversion between OpenAI API format and the generic schema.
 */
import { BaseConverter } from './base.js';
import { PROVIDER_CAPABILITIES, MODEL_MAPPINGS } from '../types/providers.js';
export class OpenAIConverter extends BaseConverter {
    provider = 'openai';
    capabilities = PROVIDER_CAPABILITIES.openai;
    // Request conversion: OpenAI → Generic
    async toGeneric(request, context) {
        const ctx = context ?? this.createContext('openai');
        this.logTransformation(ctx, 'openai_to_generic', 'Converting OpenAI request to generic format');
        const genericRequest = {
            provider: 'openai',
            model: request.model,
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
            logitBias: request.logit_bias,
            logprobs: request.logprobs,
            topLogprobs: request.top_logprobs,
            n: request.n,
        };
        return genericRequest;
    }
    // Request conversion: Generic → OpenAI
    async fromGeneric(request, context) {
        const ctx = context ?? this.createContext('openai');
        this.logTransformation(ctx, 'generic_to_openai', 'Converting generic request to OpenAI format');
        const openaiRequest = {
            model: await this.resolveModel(request.model),
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
            logit_bias: request.logitBias,
            logprobs: request.logprobs,
            top_logprobs: request.topLogprobs,
            n: request.n,
        };
        // Handle response format
        if (request.responseFormat) {
            if (typeof request.responseFormat === 'string') {
                openaiRequest.response_format = { type: request.responseFormat };
            }
            else {
                openaiRequest.response_format = request.responseFormat;
            }
        }
        // Handle stream options
        if (request.streamOptions) {
            openaiRequest.stream_options = {
                include_usage: request.streamOptions.includeUsage
            };
        }
        // Remove undefined values
        Object.keys(openaiRequest).forEach(key => {
            if (openaiRequest[key] === undefined) {
                delete openaiRequest[key];
            }
        });
        return openaiRequest;
    }
    // Response conversion: OpenAI → Generic
    async responseToGeneric(response, context) {
        const ctx = context ?? this.createContext('openai');
        this.logTransformation(ctx, 'openai_response_to_generic', 'Converting OpenAI response to generic format');
        const genericResponse = {
            id: response.id,
            object: response.object,
            created: response.created,
            model: response.model,
            provider: 'openai',
            choices: response.choices || [],
            usage: response.usage ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
            } : undefined,
            systemFingerprint: response.system_fingerprint,
        };
        return genericResponse;
    }
    // Response conversion: Generic → OpenAI
    async responseFromGeneric(response, context) {
        const ctx = context ?? this.createContext('openai');
        this.logTransformation(ctx, 'generic_response_to_openai', 'Converting generic response to OpenAI format');
        const openaiResponse = {
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
        return openaiResponse;
    }
    // Stream chunk conversion: OpenAI → Generic
    async chunkToGeneric(chunk, context) {
        if (!chunk || typeof chunk !== 'object')
            return null;
        const genericChunk = {
            id: chunk.id,
            object: 'chat.completion.chunk',
            created: chunk.created,
            model: chunk.model,
            provider: 'openai',
            choices: chunk.choices || [],
            usage: chunk.usage ? {
                promptTokens: chunk.usage.prompt_tokens,
                completionTokens: chunk.usage.completion_tokens,
                totalTokens: chunk.usage.total_tokens
            } : undefined
        };
        return genericChunk;
    }
    // Stream chunk conversion: Generic → OpenAI
    async chunkFromGeneric(chunk, context) {
        const openaiChunk = {
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
        return openaiChunk;
    }
    // Model resolution
    async resolveModel(model) {
        const mapping = MODEL_MAPPINGS.find(m => m.generic === model);
        if (mapping?.openai) {
            return mapping.openai;
        }
        return model;
    }
    async normalizeModel(model) {
        const mapping = MODEL_MAPPINGS.find(m => m.openai === model || m.aliases?.includes(model));
        if (mapping) {
            return mapping.generic;
        }
        return model;
    }
}
