/**
 * Ollama Provider Converter - Clean Version
 *
 * Handles conversion between Ollama API format and the generic schema.
 */
import { BaseConverter } from './base.js';
import { PROVIDER_CAPABILITIES, MODEL_MAPPINGS } from '../types/providers.js';
export class OllamaConverter extends BaseConverter {
    provider = 'ollama';
    capabilities = PROVIDER_CAPABILITIES.ollama;
    // Request conversion: Ollama → Generic
    async toGeneric(request, _context) {
        const genericRequest = {
            provider: 'ollama',
            model: request.model,
            messages: request.messages || [],
            // Map Ollama parameters to generic names
            maxTokens: request.num_predict,
            temperature: request.temperature,
            topP: request.top_p,
            topK: request.top_k,
            repetitionPenalty: request.repeat_penalty,
            seed: request.seed,
            stop: request.stop,
            // Response format
            responseFormat: request.format === 'json' ? 'json_object' : 'text',
            // Streaming
            stream: request.stream,
            // Ollama extensions
            extensions: {
                ollama: {
                    numPredict: request.num_predict,
                    numCtx: request.num_ctx,
                    mirostat: request.mirostat,
                    mirostatEta: request.mirostat_eta,
                    mirostatTau: request.mirostat_tau,
                    tfsZ: request.tfs_z,
                    keepAlive: request.keep_alive,
                }
            }
        };
        // Clean undefined values
        Object.keys(genericRequest.extensions?.ollama || {}).forEach(key => {
            if (genericRequest.extensions.ollama[key] === undefined) {
                delete genericRequest.extensions.ollama[key];
            }
        });
        return genericRequest;
    }
    // Request conversion: Generic → Ollama
    async fromGeneric(request, _context) {
        const ollamaRequest = {
            model: await this.resolveModel(request.model),
            messages: this.convertMessagesFromGeneric(request.messages),
            // Map generic parameters to Ollama names
            num_predict: request.maxTokens,
            temperature: request.temperature,
            top_p: request.topP,
            top_k: request.topK,
            repeat_penalty: request.repetitionPenalty,
            seed: request.seed,
            stop: Array.isArray(request.stop) ? request.stop : (request.stop ? [request.stop] : undefined),
            // Response format
            format: request.responseFormat === 'json_object' ? 'json' : undefined,
            // Streaming
            stream: request.stream,
        };
        // Add Ollama-specific parameters from extensions
        if (request.extensions?.ollama) {
            const ollama = request.extensions.ollama;
            if (ollama.numCtx)
                ollamaRequest.num_ctx = ollama.numCtx;
            if (ollama.mirostat)
                ollamaRequest.mirostat = ollama.mirostat;
            if (ollama.mirostatEta)
                ollamaRequest.mirostat_eta = ollama.mirostatEta;
            if (ollama.mirostatTau)
                ollamaRequest.mirostat_tau = ollama.mirostatTau;
            if (ollama.tfsZ)
                ollamaRequest.tfs_z = ollama.tfsZ;
            if (ollama.keepAlive)
                ollamaRequest.keep_alive = ollama.keepAlive;
        }
        // Handle unsupported features - convert tool calls to instructions
        if (request.tools && request.tools.length > 0) {
            const toolInstructions = this.convertToolsToInstructions(request.tools);
            ollamaRequest.messages.unshift({
                role: 'system',
                content: toolInstructions
            });
        }
        // Clean undefined values
        Object.keys(ollamaRequest).forEach(key => {
            if (ollamaRequest[key] === undefined) {
                delete ollamaRequest[key];
            }
        });
        return ollamaRequest;
    }
    // Response conversion: Ollama → Generic
    async responseToGeneric(response, _context) {
        const genericResponse = {
            id: this.generateId('ollama'),
            object: 'chat.completion',
            created: this.parseOllamaTimestamp(response.created_at),
            model: response.model,
            provider: 'ollama',
            choices: [{
                    index: 0,
                    message: {
                        role: response.message?.role || 'assistant',
                        content: response.message?.content || '',
                    },
                    finishReason: response.done ? 'stop' : null,
                }],
            // Approximate usage from Ollama timing data
            usage: {
                promptTokens: response.prompt_eval_count || 0,
                completionTokens: response.eval_count || 0,
                totalTokens: (response.prompt_eval_count || 0) + (response.eval_count || 0),
            }
        };
        return genericResponse;
    }
    // Response conversion: Generic → Ollama
    async responseFromGeneric(response, _context) {
        const choice = response.choices[0];
        return {
            model: response.model,
            created_at: new Date(response.created * 1000).toISOString(),
            message: {
                role: choice?.message.role || 'assistant',
                content: choice?.message.content || '',
            },
            done: true,
            prompt_eval_count: response.usage?.promptTokens,
            eval_count: response.usage?.completionTokens,
        };
    }
    // Stream chunk conversion: Ollama → Generic
    async chunkToGeneric(chunk, _context) {
        if (!chunk || typeof chunk !== 'object')
            return null;
        const genericChunk = {
            id: this.generateId('ollama'),
            object: 'chat.completion.chunk',
            created: this.parseOllamaTimestamp(chunk.created_at),
            model: chunk.model,
            provider: 'ollama',
            choices: [{
                    index: 0,
                    delta: {
                        role: chunk.message?.role,
                        content: chunk.message?.content,
                    },
                    finishReason: chunk.done ? 'stop' : null,
                }],
            // Add usage info on final chunk
            usage: chunk.done ? {
                promptTokens: chunk.prompt_eval_count || 0,
                completionTokens: chunk.eval_count || 0,
                totalTokens: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0)
            } : undefined
        };
        return genericChunk;
    }
    // Stream chunk conversion: Generic → Ollama
    async chunkFromGeneric(chunk, _context) {
        const choice = chunk.choices[0];
        const isLastChunk = choice?.finishReason !== null;
        const ollamaChunk = {
            model: chunk.model,
            created_at: new Date(chunk.created * 1000).toISOString(),
            done: isLastChunk,
        };
        if (choice?.delta.content || choice?.delta.role) {
            ollamaChunk.message = {
                role: choice.delta.role,
                content: choice.delta.content,
            };
        }
        // Add timing info on last chunk if available
        if (isLastChunk && chunk.usage) {
            ollamaChunk.eval_count = chunk.usage.completionTokens;
            ollamaChunk.prompt_eval_count = chunk.usage.promptTokens;
        }
        return ollamaChunk;
    }
    // Model resolution
    async resolveModel(model) {
        const mapping = MODEL_MAPPINGS.find(m => m.generic === model);
        if (mapping?.ollama && mapping.ollama.length > 0) {
            return mapping.ollama[0];
        }
        return model;
    }
    async normalizeModel(model) {
        const mapping = MODEL_MAPPINGS.find(m => m.ollama?.includes(model) ||
            m.ollama?.some(variant => variant.startsWith(model.split(':')[0] || '')));
        if (mapping) {
            return mapping.generic;
        }
        return model;
    }
    // Helper methods
    convertMessagesFromGeneric(messages) {
        return messages
            .filter(msg => ['system', 'user', 'assistant'].includes(msg.role))
            .map(msg => ({
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        }));
    }
    convertToolsToInstructions(tools) {
        const instructions = tools.map(tool => {
            const func = tool.function;
            return `Tool: ${func.name}\nDescription: ${func.description || 'No description'}\nParameters: ${JSON.stringify(func.parameters || {})}`;
        }).join('\n\n');
        return `You have access to the following tools. When you need to use a tool, respond with a JSON object containing the tool name and parameters:\n\n${instructions}\n\nTo use a tool, respond with: {"tool": "tool_name", "parameters": {...}}`;
    }
    parseOllamaTimestamp(timestamp) {
        return Math.floor(new Date(timestamp).getTime() / 1000);
    }
}
