/**
 * Ollama Stream Converter
 *
 * Handles conversion between Ollama streaming format and the generic schema.
 * This module focuses ONLY on stream chunk conversion logic.
 */

import { extractToolCallUnified } from '../../../parsers/xml/index.js';
import { isRecord, isGenericMessageRole, type UnknownRecord } from '../../utils/typeGuards.js';

import type { OllamaStreamChunkFields } from '../../../types/ollama.js';
import type {
  GenericStreamChunk,
  GenericUsage,
  ConversionContext,
} from '../../types/index.js';

export class OllamaStreamConverter {
  /**
   * Convert Ollama stream chunk to generic format
   */
  async chunkToGeneric(
    chunk: unknown,
    normalizeOllamaToolCalls: (raw: unknown) => Array<{ id?: string; name: string; arguments: string | Record<string, unknown> }>,
    generateId: (prefix: string) => string,
    parseOllamaTimestamp: (timestamp: unknown) => number,
    logTransformation: (ctx: ConversionContext, step: string, desc: string) => void,
    context: ConversionContext
  ): Promise<GenericStreamChunk | null> {
    await Promise.resolve(); // Satisfy async requirement

    if (!isRecord(chunk)) {
      return null;
    }

    const ollamaChunk = chunk as Partial<OllamaStreamChunkFields>;

    const usage = ollamaChunk.done === true ? {
      promptTokens: typeof ollamaChunk.prompt_eval_count === 'number' ? ollamaChunk.prompt_eval_count : 0,
      completionTokens: typeof ollamaChunk.eval_count === 'number' ? ollamaChunk.eval_count : 0,
      totalTokens: (typeof ollamaChunk.prompt_eval_count === 'number' ? ollamaChunk.prompt_eval_count : 0) + (typeof ollamaChunk.eval_count === 'number' ? ollamaChunk.eval_count : 0),
    } : undefined;

    const role = isGenericMessageRole(ollamaChunk.message?.role)
      ? ollamaChunk.message?.role
      : (ollamaChunk.choices?.[0]?.delta && isGenericMessageRole(ollamaChunk.choices[0].delta.role)
        ? ollamaChunk.choices[0].delta.role
        : undefined);

    const genericChunk: Omit<GenericStreamChunk, 'usage'> & { usage?: GenericUsage } = {
      id: generateId('ollama'),
      object: 'chat.completion.chunk',
      created: parseOllamaTimestamp(ollamaChunk.created_at),
      model: typeof ollamaChunk.model === 'string' ? ollamaChunk.model : 'unknown',
      provider: 'ollama',

      choices: [{
        index: 0,
        delta: {
          ...(role && { role }),
          ...(typeof ollamaChunk.message?.content === 'string' ? { content: ollamaChunk.message.content } :
            typeof ollamaChunk.response === 'string' ? { content: ollamaChunk.response } :
              (ollamaChunk.choices?.[0]?.delta?.content !== undefined ? { content: ollamaChunk.choices[0].delta.content } : {})),
        },
        finishReason: ollamaChunk.done === true ? 'stop' : null,
      }],
    };

    if (usage !== undefined) {
      genericChunk.usage = usage;
    }

    const responseContent = typeof ollamaChunk.message?.content === 'string'
      ? ollamaChunk.message.content
      : typeof ollamaChunk.response === 'string'
        ? ollamaChunk.response
        : (ollamaChunk.choices?.[0]?.delta?.content ?? '');

    const messageToolCalls = isRecord(ollamaChunk.message)
      ? (ollamaChunk.message as UnknownRecord)['tool_calls']
      : undefined;
    const nativeToolCalls = normalizeOllamaToolCalls(
      (ollamaChunk as UnknownRecord)['tool_calls'] ?? messageToolCalls
    );

    if (nativeToolCalls.length > 0) {
      const delta = genericChunk.choices[0]?.delta;
      if (delta) {
        delete delta.content;
        delta.tool_calls = nativeToolCalls.map((call, index) => ({
          index,
          id: typeof call.id === 'string' ? call.id : generateId('toolcall'),
          type: 'function',
          function: {
            name: call.name,
            arguments: typeof call.arguments === 'string'
              ? call.arguments
              : JSON.stringify(call.arguments ?? {}),
          },
        }));
        delta.role = 'assistant';
      }

      const choice = genericChunk.choices[0];
      if (choice) {
        choice.finishReason = 'tool_calls';
      }

      logTransformation(context, 'ollama_chunk_native_tool_call', 'Converted Ollama native tool_calls stream chunk');
    } else {
      const knownToolNames = Array.isArray(context.knownToolNames) ? context.knownToolNames : [];
      if (context.enableXMLToolParsing && knownToolNames.length > 0 && responseContent) {
        // SSOT: Use unified extraction (tries wrapper first, then direct extraction)
        // This handles both models that follow instructions (use wrapper) and those that don't
        const extracted = extractToolCallUnified(responseContent, knownToolNames);
        if (extracted?.name) {
          const toolCallId = generateId('toolcall');
          const delta = genericChunk.choices[0]?.delta;
          if (delta) {
            delete delta.content;
            delta.tool_calls = [
              {
                index: 0,
                id: toolCallId,
                type: 'function',
                function: {
                  name: extracted.name,
                  arguments: typeof extracted.arguments === 'string'
                    ? extracted.arguments
                    : JSON.stringify(extracted.arguments ?? {}),
                },
              },
            ];
            delta.role = 'assistant';
          }

          const choice = genericChunk.choices[0];
          if (choice) {
            choice.finishReason = 'tool_calls';
          }

          logTransformation(context, 'ollama_chunk_xml_tool_call', 'Converted Ollama XML chunk to generic tool_calls');
        }
      }
    }

    logTransformation(context, 'ollama_chunk_to_generic', 'Converted Ollama chunk to generic format');
    return genericChunk;
  }

  /**
   * Convert generic stream chunk to Ollama format
   */
  async chunkFromGeneric(
    chunk: GenericStreamChunk,
    logTransformation: (ctx: ConversionContext, step: string, desc: string) => void,
    context: ConversionContext
  ): Promise<unknown> {
    await Promise.resolve(); // Satisfy async requirement
    logTransformation(context, 'generic_chunk_to_ollama', 'Converting generic chunk to Ollama format');

    const choice = chunk.choices[0];
    const isLastChunk = choice?.finishReason !== null && choice?.finishReason !== undefined;

    const ollamaChunk: Record<string, unknown> = {
      model: chunk.model,
      created_at: new Date(chunk.created * 1000).toISOString(),
      done: isLastChunk,
    };

    if (choice !== undefined && (choice.delta.content !== undefined || choice.delta.role !== undefined)) {
      ollamaChunk['message'] = {
        role: choice.delta.role ?? 'assistant',
        content: choice.delta.content ?? '',
      };
    }
    if (choice?.delta.content !== undefined && choice.delta.content !== null) {
      ollamaChunk['response'] = choice.delta.content;
    }

    // Add timing info on last chunk if available
    if (isLastChunk && chunk.usage !== undefined) {
      ollamaChunk['eval_count'] = chunk.usage.completionTokens;
      ollamaChunk['prompt_eval_count'] = chunk.usage.promptTokens;
    }

    return ollamaChunk;
  }
}
