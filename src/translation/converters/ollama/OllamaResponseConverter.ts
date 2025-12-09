/**
 * Ollama Response Converter
 *
 * Handles conversion between Ollama response format and the generic schema.
 * This module focuses ONLY on response conversion logic.
 */

import { extractToolCallsUnified } from '../../../parsers/xml/index.js';
import { isRecord, type UnknownRecord } from '../../utils/typeGuards.js';

import type { OllamaResponseFields } from '../../../types/ollama.js';
import type {
  GenericLLMResponse,
  GenericToolCall,
  ConversionContext,
} from '../../types/index.js';

export class OllamaResponseConverter {
  /**
   * Convert Ollama response to generic format
   */
  async toGeneric(
    response: unknown,
    normalizeOllamaToolCalls: (raw: unknown) => Array<{ id?: string; name: string; arguments: string | Record<string, unknown> }>,
    generateId: (prefix: string) => string,
    parseOllamaTimestamp: (timestamp: unknown) => number,
    logTransformation: (ctx: ConversionContext, step: string, desc: string) => void,
    context: ConversionContext
  ): Promise<GenericLLMResponse> {
    await Promise.resolve(); // Satisfy async requirement
    logTransformation(context, 'ollama_response_to_generic', 'Converting Ollama response to generic format');

    if (!isRecord(response)) {
      throw new Error('Invalid Ollama response: must be an object');
    }

    const ollamaResp = response as Partial<OllamaResponseFields>;

    const responseContent = typeof ollamaResp.message?.content === 'string'
      ? ollamaResp.message.content
      : typeof ollamaResp.response === 'string'
        ? ollamaResp.response
        : '';

    const genericResponse: GenericLLMResponse = {
      id: generateId('ollama'),
      object: 'chat.completion',
      created: parseOllamaTimestamp(ollamaResp.created_at),
      model: typeof ollamaResp.model === 'string' ? ollamaResp.model : 'unknown',
      provider: 'ollama',

      choices: [{
        index: 0,
        message: {
          role: (ollamaResp.message?.role === 'system' || ollamaResp.message?.role === 'user' || ollamaResp.message?.role === 'assistant')
            ? ollamaResp.message.role
            : 'assistant',
          content: responseContent,
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

    const messageToolCalls = isRecord(ollamaResp.message)
      ? (ollamaResp.message as UnknownRecord)['tool_calls']
      : undefined;
    const nativeToolCalls = normalizeOllamaToolCalls(
      (ollamaResp as UnknownRecord)['tool_calls'] ?? messageToolCalls
    );

    const firstChoice = genericResponse.choices[0];

    if (nativeToolCalls.length > 0 && firstChoice) {
      firstChoice.message.tool_calls = nativeToolCalls.map((call): GenericToolCall => ({
        id: typeof call.id === 'string' ? call.id : generateId('toolcall'),
        type: 'function',
        function: {
          name: call.name,
          arguments: typeof call.arguments === 'string'
            ? call.arguments
            : JSON.stringify(call.arguments ?? {}),
        },
      }));

      delete firstChoice.message.content;
      firstChoice.finishReason = 'tool_calls';
      logTransformation(context, 'ollama_response_native_tool_call', 'Converted Ollama native tool_calls to generic format');
    } else {
      const knownToolNames = Array.isArray(context.knownToolNames) ? context.knownToolNames : [];
      if (context.enableXMLToolParsing && knownToolNames.length > 0 && responseContent && firstChoice) {
        // SSOT: Use unified extraction (tries wrapper first, then direct extraction)
        // This handles both models that follow instructions (use wrapper) and those that don't
        const extractedCalls = extractToolCallsUnified(responseContent, knownToolNames);
        if (extractedCalls.length > 0) {
          firstChoice.message.tool_calls = extractedCalls.map((call): GenericToolCall => ({
            id: generateId('toolcall'),
            type: 'function',
            function: {
              name: call.name,
              arguments: typeof call.arguments === 'string'
                ? call.arguments
                : JSON.stringify(call.arguments ?? {}),
            },
          }));

          delete firstChoice.message.content;
          firstChoice.finishReason = 'tool_calls';
          logTransformation(context, 'ollama_response_xml_tool_call', 'Converted Ollama XML tool call to generic tool_calls');
        }
      }
    }

    return genericResponse;
  }

  /**
   * Convert generic response to Ollama format
   */
  async fromGeneric(
    response: GenericLLMResponse,
    logTransformation: (ctx: ConversionContext, step: string, desc: string) => void,
    context: ConversionContext
  ): Promise<unknown> {
    await Promise.resolve(); // Satisfy async requirement
    logTransformation(context, 'generic_response_to_ollama', 'Converting generic response to Ollama format');

    const choice = response.choices[0];
    const role = choice?.message.role ?? 'assistant';
    const content = choice?.message.content ?? '';

    const ollamaResponse: Partial<OllamaResponseFields> = {
      model: response.model,
      created_at: new Date(response.created * 1000).toISOString(),
      message: {
        role: (role === 'system' || role === 'user' || role === 'assistant') ? role : 'assistant',
        content: typeof content === 'string' ? content : JSON.stringify(content),
        thinking: "",
      },
      done: true,
    };
    if (typeof content === 'string') {
      ollamaResponse.response = content;
    } else if (content !== undefined) {
      ollamaResponse.response = JSON.stringify(content);
    }

    if (response.usage?.promptTokens !== undefined) {
      ollamaResponse.prompt_eval_count = response.usage.promptTokens;
    }
    if (response.usage?.completionTokens !== undefined) {
      ollamaResponse.eval_count = response.usage.completionTokens;
    }

    return ollamaResponse;
  }
}
