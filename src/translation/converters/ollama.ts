/**
 * Ollama Provider Converter - Strict TypeScript Version
 * 
 * Handles conversion between Ollama API format and the generic schema.
 * Follows ultra-strict typing patterns with no \`any\`, no \`||\`, no non-null assertions.
 */

import { MODEL_MAPPINGS, PROVIDER_CAPABILITIES } from '../types/providers.js';

import { BaseConverter } from './base.js';

import type { OllamaMessage, OllamaRequest, OllamaResponse, OllamaStreamChunk } from '../../types/ollama.js';
import type {
  ConversionContext,
  GenericLLMRequest,
  GenericLLMResponse,
  GenericStreamChunk,
  GenericTool,
  GenericUsage,
  LLMProvider,
  ProviderCapabilities,
} from '../types/index.js';


type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class OllamaConverter extends BaseConverter {
  readonly provider: LLMProvider = 'ollama';
  readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.ollama;
  
  // Request conversion: Ollama → Generic
  async toGeneric(request: unknown, context?: ConversionContext): Promise<GenericLLMRequest> {
    await Promise.resolve(); // Satisfy async requirement
    const ctx = context ?? this.createContext('ollama');
    this.logTransformation(ctx, 'ollama_to_generic', 'Converting Ollama request to generic format');

    if (!isRecord(request)) {
      throw new Error('Invalid Ollama request: must be an object');
    }

    const ollamaReq = request as Partial<OllamaRequest>;
    
    const genericRequest: GenericLLMRequest = {
      provider: 'ollama',
      model: typeof ollamaReq.model === 'string' ? ollamaReq.model : '',
      messages: this.convertMessagesToGeneric(ollamaReq.messages),
      
      // Map Ollama parameters to generic names
      maxTokens: typeof ollamaReq.options?.num_predict === 'number' ? ollamaReq.options.num_predict : undefined,
      temperature: typeof ollamaReq.options?.temperature === 'number' ? ollamaReq.options.temperature : undefined,
      topP: typeof ollamaReq.options?.top_p === 'number' ? ollamaReq.options.top_p : undefined,
      topK: typeof ollamaReq.options?.top_k === 'number' ? ollamaReq.options.top_k : undefined,
      repetitionPenalty: typeof ollamaReq.options?.repeat_penalty === 'number' ? ollamaReq.options.repeat_penalty : undefined,
      seed: typeof ollamaReq.options?.seed === 'number' ? ollamaReq.options.seed : undefined,
      stop: ollamaReq.stop,
      
      // Response format
      responseFormat: ollamaReq.format === 'json' ? 'json_object' : 'text',
      
      // Streaming
      stream: typeof ollamaReq.stream === 'boolean' ? ollamaReq.stream : undefined,
      
      // Ollama extensions
      extensions: {
        ollama: this.extractOllamaExtensions(ollamaReq),
      },
    };
    
    return genericRequest;
  }
  
  // Request conversion: Generic → Ollama
  async fromGeneric(request: GenericLLMRequest, context?: ConversionContext): Promise<unknown> {
    const ctx = context ?? this.createContext('ollama');
    this.logTransformation(ctx, 'generic_to_ollama', 'Converting generic request to Ollama format');
    
    const ollamaRequest: Partial<OllamaRequest> = {
      model: await this.resolveModel(request.model),
      messages: this.convertMessagesFromGeneric(request.messages),
      stream: request.stream,
      format: request.responseFormat === 'json_object' ? 'json' : undefined,
    };

    // Build options object
    const options: NonNullable<OllamaRequest['options']> = {};
    
    if (typeof request.maxTokens === 'number') {
      options.num_predict = request.maxTokens;
    }
    if (typeof request.temperature === 'number') {
      options.temperature = request.temperature;
    }
    if (typeof request.topP === 'number') {
      options.top_p = request.topP;
    }
    if (typeof request.topK === 'number') {
      options.top_k = request.topK;
    }
    if (typeof request.repetitionPenalty === 'number') {
      options.repeat_penalty = request.repetitionPenalty;
    }
    if (typeof request.seed === 'number') {
      options.seed = request.seed;
    }
    if (request.stop !== undefined) {
      options.stop = request.stop;
    }

    if (Object.keys(options).length > 0) {
      ollamaRequest.options = options;
    }
    
    // Add Ollama-specific parameters from extensions
    if (isRecord(request.extensions) && isRecord(request.extensions.ollama)) {
      const ollama = request.extensions.ollama;
      const opts = ollamaRequest.options ?? {};
      
      if (typeof ollama.numCtx === 'number') {
        opts.num_ctx = ollama.numCtx;
      }
      if (typeof ollama.numPredict === 'number') {
        opts.num_predict = ollama.numPredict;
      }
      
      if (Object.keys(opts).length > 0) {
        ollamaRequest.options = opts;
      }
      
      if (typeof ollama.keepAlive === 'string' || typeof ollama.keepAlive === 'number') {
        ollamaRequest.keep_alive = ollama.keepAlive;
      }
    }
    
    // Handle unsupported features - convert tool calls to instructions
    if (Array.isArray(request.tools) && request.tools.length > 0) {
      const toolInstructions = this.convertToolsToInstructions(request.tools);
      const messages = ollamaRequest.messages ?? [];
      messages.unshift({
        role: 'system',
        content: toolInstructions,
      });
      ollamaRequest.messages = messages;
    }
    
    return ollamaRequest;
  }
  
  // Response conversion: Ollama → Generic
  async responseToGeneric(response: unknown, context?: ConversionContext): Promise<GenericLLMResponse> {
    await Promise.resolve(); // Satisfy async requirement
    const ctx = context ?? this.createContext('ollama');
    this.logTransformation(ctx, 'ollama_response_to_generic', 'Converting Ollama response to generic format');

    if (!isRecord(response)) {
      throw new Error('Invalid Ollama response: must be an object');
    }

    const ollamaResp = response as Partial<OllamaResponse>;
    
    const genericResponse: GenericLLMResponse = {
      id: this.generateId('ollama'),
      object: 'chat.completion',
      created: this.parseOllamaTimestamp(ollamaResp.created_at),
      model: typeof ollamaResp.model === 'string' ? ollamaResp.model : 'unknown',
      provider: 'ollama',
      
      choices: [{
        index: 0,
        message: {
          role: ollamaResp.message?.role ?? 'assistant',
          content: ollamaResp.message?.content ?? '',
        },
        finishReason: ollamaResp.done === true ? 'stop' : null,
      }],
      
      // Approximate usage from Ollama timing data
      usage: {
        promptTokens: typeof ollamaResp.prompt_eval_count === 'number' ? ollamaResp.prompt_eval_count : 0,
        completionTokens: typeof ollamaResp.eval_count === 'number' ? ollamaResp.eval_count : 0,
        totalTokens: (typeof ollamaResp.prompt_eval_count === 'number' ? ollamaResp.prompt_eval_count : 0) + (typeof ollamaResp.eval_count === 'number' ? ollamaResp.eval_count : 0),
      },
    };
    
    return genericResponse;
  }
  
  //Response conversion: Generic → Ollama
  async responseFromGeneric(response: GenericLLMResponse, context?: ConversionContext): Promise<unknown> {
    await Promise.resolve(); // Satisfy async requirement
    const ctx = context ?? this.createContext('ollama');
    this.logTransformation(ctx, 'generic_response_to_ollama', 'Converting generic response to Ollama format');
    
    const choice = response.choices[0];
    const role = choice?.message.role ?? 'assistant';
    const content = choice?.message.content ?? '';
    
    const ollamaResponse: Omit<Partial<OllamaResponse>, 'prompt_eval_count' | 'eval_count'> & { prompt_eval_count?: number; eval_count?: number } = {
      model: response.model,
      created_at: new Date(response.created * 1000).toISOString(),
      message: {
        role: (role === 'system' || role === 'user' || role === 'assistant') ? role : 'assistant',
        content: typeof content === 'string' ? content : JSON.stringify(content),
      },
      done: true,
    };
    
    if (response.usage?.promptTokens !== undefined) {
      ollamaResponse.prompt_eval_count = response.usage.promptTokens;
    }
    if (response.usage?.completionTokens !== undefined) {
      ollamaResponse.eval_count = response.usage.completionTokens;
    }
    
    return ollamaResponse;
  }
  
  // Stream chunk conversion: Ollama → Generic
  async chunkToGeneric(chunk: unknown, context?: ConversionContext): Promise<GenericStreamChunk | null> {
    await Promise.resolve(); // Satisfy async requirement
    const ctx = context ?? this.createContext('ollama');
    
    if (!isRecord(chunk)) {
      return null;
    }
    
    const ollamaChunk = chunk as Partial<OllamaStreamChunk> & { message?: OllamaMessage };
    
    const usage = ollamaChunk.done === true ? {
      promptTokens: typeof ollamaChunk.prompt_eval_count === 'number' ? ollamaChunk.prompt_eval_count : 0,
      completionTokens: typeof ollamaChunk.eval_count === 'number' ? ollamaChunk.eval_count : 0,
      totalTokens: (typeof ollamaChunk.prompt_eval_count === 'number' ? ollamaChunk.prompt_eval_count : 0) + (typeof ollamaChunk.eval_count === 'number' ? ollamaChunk.eval_count : 0),
    } : undefined;
    
    const genericChunk: Omit<GenericStreamChunk, 'usage'> & { usage?: GenericUsage } = {
      id: this.generateId('ollama'),
      object: 'chat.completion.chunk',
      created: this.parseOllamaTimestamp(ollamaChunk.created_at),
      model: typeof ollamaChunk.model === 'string' ? ollamaChunk.model : 'unknown',
      provider: 'ollama',
      
      choices: [{
        index: 0,
        delta: {
          role: typeof ollamaChunk.message?.role === 'string' ? ollamaChunk.message.role : undefined,
          content: typeof ollamaChunk.message?.content === 'string' ? ollamaChunk.message.content : (typeof ollamaChunk.response === 'string' ? ollamaChunk.response : undefined),
        },
        finishReason: ollamaChunk.done === true ? 'stop' : null,
      }],
    };
    
    if (usage !== undefined) {
      genericChunk.usage = usage;
    }
    
    this.logTransformation(ctx, 'ollama_chunk_to_generic', 'Converted Ollama chunk to generic format');
    return genericChunk;
  }
  
  // Stream chunk conversion: Generic → Ollama
  async chunkFromGeneric(chunk: GenericStreamChunk, context?: ConversionContext): Promise<unknown> {
    await Promise.resolve(); // Satisfy async requirement
    const ctx = context ?? this.createContext('ollama');
    this.logTransformation(ctx, 'generic_chunk_to_ollama', 'Converting generic chunk to Ollama format');
    
    const choice = chunk.choices[0];
    const isLastChunk = choice?.finishReason !== null && choice?.finishReason !== undefined;
    
    const ollamaChunk: Record<string, unknown> = {
      model: chunk.model,
      created_at: new Date(chunk.created * 1000).toISOString(),
      done: isLastChunk,
    };
    
    if (choice !== undefined && (choice.delta.content !== undefined || choice.delta.role !== undefined)) {
      ollamaChunk.message = {
        role: choice.delta.role ?? 'assistant',
        content: choice.delta.content ?? '',
      };
    }
    
    // Add timing info on last chunk if available
    if (isLastChunk && chunk.usage !== undefined) {
      ollamaChunk.eval_count = chunk.usage.completionTokens;
      ollamaChunk.prompt_eval_count = chunk.usage.promptTokens;
    }
    
    return ollamaChunk;
  }
  
  // Model resolution
  async resolveModel(model: string): Promise<string> {
    await Promise.resolve(); // Satisfy async requirement
    const mapping = MODEL_MAPPINGS.find(m => m.generic === model);
    if (mapping?.ollama !== undefined && Array.isArray(mapping.ollama) && mapping.ollama.length > 0) {
      return mapping.ollama[0];
    }
    return model;
  }
  
  async normalizeModel(model: string): Promise<string> {
    await Promise.resolve(); // Satisfy async requirement
    const mapping = MODEL_MAPPINGS.find(m => {
      if (m.ollama === undefined || !Array.isArray(m.ollama)) {
        return false;
      }
      return m.ollama.includes(model) || m.ollama.some(variant => {
        const baseModel = model.split(':')[0];
        return baseModel !== undefined && variant.startsWith(baseModel);
      });
    });
    if (mapping !== undefined) {
      return mapping.generic;
    }
    return model;
  }
  
  // Helper methods
  private convertMessagesToGeneric(messages: unknown): GenericLLMRequest['messages'] {
    if (!Array.isArray(messages)) {
      return [];
    }
    
    return messages
      .filter((msg): msg is OllamaMessage => {
        return isRecord(msg) && 
               typeof (msg as Record<string, unknown>).role === 'string' &&
               ['system', 'user', 'assistant'].includes((msg as Record<string, unknown>).role as string);
      })
      .map(msg => ({
        role: msg.role,
        content: msg.content,
      }));
  }

  private convertMessagesFromGeneric(messages: GenericLLMRequest['messages']): OllamaMessage[] {
    return messages
      .filter(msg => ['system', 'user', 'assistant'].includes(msg.role))
      .map(msg => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      }));
  }
  
  private convertToolsToInstructions(tools: GenericTool[]): string {
    const toolDescriptions = tools.map(tool => {
      const func = tool.function;
      const params = func.parameters ?? {};
      const paramsList = Object.entries(params as Record<string, unknown>)
        .map(([key, value]) => `  - ${key}: ${JSON.stringify(value)}`)
        .join('\n');
      
      return `<${func.name}>
  Description: ${func.description ?? 'No description'}
  Parameters:
${paramsList || '  (no parameters)'}
</${func.name}>`;
    }).join('\n\n');
    
    return `You have access to the following tools. When you need to use a tool, wrap ALL tool calls inside <toolbridge:calls> tags and use XML format:

Available Tools:
${toolDescriptions}

IMPORTANT: You MUST wrap all tool calls inside <toolbridge:calls></toolbridge:calls> tags.

Example format:
<toolbridge:calls>
<tool_name>
  <param1>value1</param1>
  <param2>value2</param2>
</tool_name>
</toolbridge:calls>

Multiple tool calls:
<toolbridge:calls>
<tool_name_1>
  <param>value</param>
</tool_name_1>
<tool_name_2>
  <param>value</param>
</tool_name_2>
</toolbridge:calls>`;
  }
  
  private parseOllamaTimestamp(timestamp: unknown): number {
    if (typeof timestamp === 'string') {
      return Math.floor(new Date(timestamp).getTime() / 1000);
    }
    return Math.floor(Date.now() / 1000);
  }

  private extractOllamaExtensions(request: Partial<OllamaRequest>): UnknownRecord {
    const extensions: UnknownRecord = {};
    
    if (typeof request.options?.num_predict === 'number') {
      extensions.numPredict = request.options.num_predict;
    }
    if (typeof request.options?.num_ctx === 'number') {
      extensions.numCtx = request.options.num_ctx;
    }
    if (request.keep_alive !== undefined) {
      extensions.keepAlive = request.keep_alive;
    }
    
    return extensions;
  }
}
