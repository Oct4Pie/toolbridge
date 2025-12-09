/**
 * Ollama Request Converter
 *
 * Handles conversion between Ollama request format and the generic schema.
 * This module focuses ONLY on request conversion logic.
 */

import { isRecord, type UnknownRecord } from '../../utils/typeGuards.js';

import type { OllamaMessage, OllamaRequest } from '../../../types/ollama.js';
import type {
  GenericLLMRequest,
  GenericTool,
  ConversionContext,
} from '../../types/index.js';

export class OllamaRequestConverter {
  /**
   * Convert Ollama request to generic format
   */
  async toGeneric(
    request: unknown,
    extractOllamaExtensions: (req: Partial<OllamaRequest>) => UnknownRecord,
    logTransformation: (ctx: ConversionContext, step: string, desc: string) => void,
    context: ConversionContext
  ): Promise<GenericLLMRequest> {
    await Promise.resolve(); // Satisfy async requirement
    logTransformation(context, 'ollama_to_generic', 'Converting Ollama request to generic format');

    if (!isRecord(request)) {
      throw new Error('Invalid Ollama request: must be an object');
    }

    const ollamaReq = request as Partial<OllamaRequest>;

    // Handle Ollama's generate format (prompt field) vs chat format (messages field)
    let messages: OllamaMessage[] | undefined = ollamaReq.messages;
    if (!messages && typeof ollamaReq.prompt === 'string') {
      // Convert prompt to messages format
      messages = [{ role: 'user', content: ollamaReq.prompt }];
      logTransformation(context, 'ollama_prompt_to_messages', 'Converted Ollama prompt to messages format');
    }

    const genericRequest: GenericLLMRequest = {
      provider: 'ollama',
      model: typeof ollamaReq.model === 'string' ? ollamaReq.model : '',
      messages: this.convertMessagesToGeneric(messages),

      // Map Ollama parameters to generic names
      ...(typeof ollamaReq.options?.num_predict === 'number' && { maxTokens: ollamaReq.options.num_predict }),
      ...(typeof ollamaReq.options?.temperature === 'number' && { temperature: ollamaReq.options.temperature }),
      ...(typeof ollamaReq.options?.top_p === 'number' && { topP: ollamaReq.options.top_p }),
      ...(typeof ollamaReq.options?.top_k === 'number' && { topK: ollamaReq.options.top_k }),
      ...(typeof ollamaReq.options?.repeat_penalty === 'number' && { repetitionPenalty: ollamaReq.options.repeat_penalty }),
      ...(typeof ollamaReq.options?.seed === 'number' && { seed: ollamaReq.options.seed }),
      ...(ollamaReq.stop !== undefined && { stop: ollamaReq.stop }),

      // Tools support (Ollama uses same format as OpenAI)
      ...(Array.isArray(ollamaReq.tools) && ollamaReq.tools.length > 0 && { tools: ollamaReq.tools as GenericTool[] }),

      // Response format
      responseFormat: ollamaReq.format === 'json' ? 'json_object' : 'text',

      // Streaming
      ...(typeof ollamaReq.stream === 'boolean' && { stream: ollamaReq.stream }),

      // Ollama extensions
      extensions: {
        ollama: extractOllamaExtensions(ollamaReq),
      },
    };

    return genericRequest;
  }

  /**
   * Convert generic request to Ollama format
   */
  async fromGeneric(
    request: GenericLLMRequest,
    resolveModel: (model: string) => Promise<string>,
    logTransformation: (ctx: ConversionContext, step: string, desc: string) => void,
    context: ConversionContext
  ): Promise<Partial<OllamaRequest>> {
    logTransformation(context, 'generic_to_ollama', 'Converting generic request to Ollama format');

    const ollamaRequest: Partial<OllamaRequest> = {
      model: await resolveModel(request.model),
      messages: this.convertMessagesFromGeneric(request.messages),
      ...(request.stream !== undefined && { stream: request.stream }),
      ...(request.responseFormat === 'json_object' && { format: 'json' }),
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

    return ollamaRequest;
  }

  /**
   * Convert messages from Ollama format to generic format
   */
  private convertMessagesToGeneric(messages: unknown): GenericLLMRequest['messages'] {
    if (!Array.isArray(messages)) {
      return [];
    }

    return messages
      .filter((msg): msg is OllamaMessage => {
        return isRecord(msg) &&
               typeof (msg as Record<string, unknown>)['role'] === 'string' &&
               ['system', 'user', 'assistant'].includes((msg as Record<string, unknown>)['role'] as string);
      })
      .map(msg => ({
        role: msg.role,
        content: msg.content,
      }));
  }

  /**
   * Convert messages from generic format to Ollama format
   */
  private convertMessagesFromGeneric(messages: GenericLLMRequest['messages']): OllamaMessage[] {
    return messages
      .filter(msg => ['system', 'user', 'assistant'].includes(msg.role))
      .map(msg => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      }));
  }
}
