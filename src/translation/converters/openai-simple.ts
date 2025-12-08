/**
 * OpenAI Provider Converter - Strict TypeScript Version
 * 
 * Handles conversion between OpenAI API format and the generic schema.
 * Follows ultra-strict typing patterns with no \`any\`, no \`||\`, no non-null assertions.
 */

import { MODEL_MAPPINGS, PROVIDER_CAPABILITIES } from '../types/providers.js';
import { createConversionContext } from '../utils/contextFactory.js';
import { isRecord, isGenericMessageRole, type UnknownRecord } from '../utils/typeGuards.js';

import { BaseConverter } from './base.js';

import type { OpenAIMessage, OpenAIRequest, OpenAIResponse, OpenAIStreamChunk, OpenAITool } from '../../types/openai.js';
import type {
  ConversionContext,
  GenericChoice,
  GenericLLMRequest,
  GenericLLMResponse,
  GenericMessage,
  GenericStreamChunk,
  GenericTool,
  GenericToolChoice,
  LLMProvider,
  ProviderCapabilities,
} from '../types/index.js';

type GenericStreamToolCall = NonNullable<GenericStreamChunk['choices'][number]['delta']['tool_calls']>[number];

export class OpenAIConverter extends BaseConverter {
  readonly provider: LLMProvider = 'openai';
  readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.openai;
  
  // Request conversion: OpenAI → Generic
  async toGeneric(request: unknown, context?: ConversionContext): Promise<GenericLLMRequest> {
    await Promise.resolve(); // Satisfy async requirement
    const ctx = context ?? createConversionContext(this.provider, this.provider);
    this.logTransformation(ctx, 'openai_to_generic', 'Converting OpenAI request to generic format');
    
    if (!isRecord(request)) {
      throw new Error('Invalid OpenAI request: must be an object');
    }

    const openaiReq = request as Partial<OpenAIRequest>;
    
    const genericRequest: GenericLLMRequest = {
      provider: 'openai',
      model: typeof openaiReq.model === 'string' ? openaiReq.model : '',
      messages: Array.isArray(openaiReq.messages) ? openaiReq.messages as GenericMessage[] : [],
      ...(typeof openaiReq.max_tokens === 'number' && { maxTokens: openaiReq.max_tokens }),
      ...(typeof openaiReq.temperature === 'number' && { temperature: openaiReq.temperature }),
      ...(typeof openaiReq.top_p === 'number' && { topP: openaiReq.top_p }),
      ...(typeof (openaiReq as UnknownRecord)['seed'] === 'number' && { seed: (openaiReq as UnknownRecord)['seed'] as number }),
      ...(openaiReq.stop !== undefined && { stop: openaiReq.stop }),
      ...(openaiReq.tools !== undefined && { tools: openaiReq.tools as GenericTool[] }),
      ...(openaiReq.tool_choice !== undefined && { toolChoice: openaiReq.tool_choice as GenericToolChoice }),
      ...(typeof openaiReq.stream === 'boolean' && { stream: openaiReq.stream }),
    };
    
    return genericRequest;
  }
  
  // Request conversion: Generic → OpenAI
  async fromGeneric(request: GenericLLMRequest, context?: ConversionContext): Promise<unknown> {
    const ctx = context ?? createConversionContext(this.provider, this.provider);
    this.logTransformation(ctx, 'generic_to_openai', 'Converting generic request to OpenAI format');

    // Convert multimodal content to plain strings
    const normalizedMessages = request.messages.map(msg => ({
      ...msg,
      content: this.extractStringContent(msg.content),
    }));

    const openaiRequest: Partial<OpenAIRequest> = {
      model: await this.resolveModel(request.model),
      messages: normalizedMessages as OpenAIMessage[],
      ...(typeof request.maxTokens === 'number' && { max_tokens: request.maxTokens }),
      ...(typeof request.temperature === 'number' && { temperature: request.temperature }),
      ...(typeof request.topP === 'number' && { top_p: request.topP }),
      ...(request.stop !== undefined && { stop: request.stop }),
      ...(request.tools !== undefined && { tools: request.tools as OpenAITool[] }),
      ...(request.stream !== undefined && { stream: request.stream }),
    };

    // Handle tool_choice separately since it's optional (needs type assertion due to exact types)
    const toolChoice = request.toolChoice;
    if (toolChoice !== undefined) {
      // Type narrowing: toolChoice is no longer undefined here
      openaiRequest.tool_choice = toolChoice as 'none' | 'auto' | { type: 'function'; function: { name: string } };
    }

    // Handle response format
    if (request.responseFormat !== undefined) {
      if (typeof request.responseFormat === 'string') {
        (openaiRequest as UnknownRecord)['response_format'] = { type: request.responseFormat };
      } else {
        (openaiRequest as UnknownRecord)['response_format'] = request.responseFormat;
      }
    }

    // Handle seed parameter
    if (typeof request.seed === 'number') {
      (openaiRequest as UnknownRecord)['seed'] = request['seed'];
    }

    // Handle stream options
    if (isRecord(request.streamOptions)) {
      (openaiRequest as UnknownRecord)['stream_options'] = {
        include_usage: request.streamOptions.includeUsage,
      };
    }

    return openaiRequest;
  }
  
  // Response conversion: OpenAI → Generic
  async responseToGeneric(response: unknown, context?: ConversionContext): Promise<GenericLLMResponse> {
    await Promise.resolve(); // Satisfy async requirement
    const ctx = context ?? createConversionContext(this.provider, this.provider);
    this.logTransformation(ctx, 'openai_response_to_generic', 'Converting OpenAI response to generic format');
    
    if (!isRecord(response)) {
      throw new Error('Invalid OpenAI response: must be an object');
    }

    const openaiResp = response as Partial<OpenAIResponse>;
    
    const usage = isRecord(openaiResp.usage) ? {
      promptTokens: typeof openaiResp.usage.prompt_tokens === 'number' ? openaiResp.usage.prompt_tokens : 0,
      completionTokens: typeof openaiResp.usage.completion_tokens === 'number' ? openaiResp.usage.completion_tokens : 0,
      totalTokens: typeof openaiResp.usage.total_tokens === 'number' ? openaiResp.usage.total_tokens : 0,
    } : undefined;
    
    const genericResponse: GenericLLMResponse = {
      id: typeof openaiResp.id === 'string' ? openaiResp.id : this.generateId('openai'),
      object: 'chat.completion',
      created: typeof openaiResp.created === 'number' ? openaiResp.created : this.getCurrentTimestamp(),
      model: typeof openaiResp.model === 'string' ? openaiResp.model : 'unknown',
      provider: 'openai',
      choices: Array.isArray(openaiResp.choices) ? openaiResp.choices as unknown as GenericChoice[] : [],
      ...(usage !== undefined && { usage }),
      ...(typeof (openaiResp as UnknownRecord)['system_fingerprint'] === 'string' && { 
        systemFingerprint: (openaiResp as UnknownRecord)['system_fingerprint'] as string 
      }),
    };
    
    return genericResponse;
  }
  
  // Response conversion: Generic → OpenAI
  async responseFromGeneric(response: GenericLLMResponse, context?: ConversionContext): Promise<unknown> {
    await Promise.resolve(); // Satisfy async requirement
    const ctx = context ?? createConversionContext(this.provider, this.provider);
    this.logTransformation(ctx, 'generic_response_to_openai', 'Converting generic response to OpenAI format');
    
    const openaiResponse: Partial<OpenAIResponse> = {
      id: response.id,
      object: 'chat.completion',
      created: response.created,
      model: response.model,
      choices: response.choices.map(choice => ({
        index: choice.index,
        message: choice.message as OpenAIMessage,
        finish_reason: choice.finishReason, // Convert camelCase to snake_case
        logprobs: choice.logprobs,
      })) as OpenAIResponse['choices'],
      usage: response.usage !== undefined ? {
        prompt_tokens: response.usage.promptTokens,
        completion_tokens: response.usage.completionTokens,
        total_tokens: response.usage.totalTokens,
      } : {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
    
    if (typeof response.systemFingerprint === 'string') {
      (openaiResponse as UnknownRecord)['system_fingerprint'] = response.systemFingerprint;
    }
    
    return openaiResponse;
  }
  
  // Stream chunk conversion: OpenAI → Generic
  async chunkToGeneric(chunk: unknown, context?: ConversionContext): Promise<GenericStreamChunk | null> {
    await Promise.resolve(); // Satisfy async requirement
    const ctx = context ?? createConversionContext(this.provider, this.provider);
    
    if (!isRecord(chunk)) {
      return null;
    }
    
    const openaiChunk = chunk as Partial<OpenAIStreamChunk>;
    
    const usage = isRecord(openaiChunk.usage) ? {
      promptTokens: typeof (openaiChunk.usage as UnknownRecord)['prompt_tokens'] === 'number' ? (openaiChunk.usage as UnknownRecord)['prompt_tokens'] as number : 0,
      completionTokens: typeof (openaiChunk.usage as UnknownRecord)['completion_tokens'] === 'number' ? (openaiChunk.usage as UnknownRecord)['completion_tokens'] as number : 0,
      totalTokens: typeof (openaiChunk.usage as UnknownRecord)['total_tokens'] === 'number' ? (openaiChunk.usage as UnknownRecord)['total_tokens'] as number : 0,
    } : undefined;
    
    const genericChoices = Array.isArray(openaiChunk.choices)
      ? openaiChunk.choices.map((choice, index) => this.toGenericStreamChoice(choice, index))
      : [];

    const genericChunk: GenericStreamChunk = {
      id: typeof openaiChunk.id === 'string' ? openaiChunk.id : this.generateId('openai'),
      object: 'chat.completion.chunk',
      created: typeof openaiChunk.created === 'number' ? openaiChunk.created : this.getCurrentTimestamp(),
      model: typeof openaiChunk.model === 'string' ? openaiChunk.model : 'unknown',
      provider: 'openai',
      choices: genericChoices,
      ...(usage !== undefined && { usage }),
    };
    
    this.logTransformation(ctx, 'openai_chunk_to_generic', 'Converted OpenAI chunk to generic format');
    return genericChunk;
  }
  
  // Stream chunk conversion: Generic → OpenAI
  async chunkFromGeneric(chunk: GenericStreamChunk, context?: ConversionContext): Promise<unknown> {
    await Promise.resolve(); // Satisfy async requirement
    const ctx = context ?? createConversionContext(this.provider, this.provider);
    this.logTransformation(ctx, 'generic_chunk_to_openai', 'Converting generic chunk to OpenAI format');
    
    // Map choices, allowing content to be string or null (per OpenAI spec)
    const choices = chunk.choices.map(choice => ({
      index: choice.index,
      delta: {
        role: choice.delta.role,
        content: choice.delta.content ?? null,
        tool_calls: choice.delta.tool_calls,
      },
      finish_reason: choice.finishReason,
      logprobs: choice.logprobs,
    }));

    const openaiChunk: Partial<OpenAIStreamChunk> = {
      id: chunk.id,
      object: 'chat.completion.chunk',
      created: chunk.created,
      model: chunk.model,
      choices: choices as OpenAIStreamChunk['choices'],
    };
    
    if (chunk.usage !== undefined) {
      (openaiChunk as UnknownRecord)['usage'] = {
        prompt_tokens: chunk.usage.promptTokens,
        completion_tokens: chunk.usage.completionTokens,
        total_tokens: chunk.usage.totalTokens,
      };
    }
    
    return openaiChunk;
  }
  
  // Model resolution
  async resolveModel(model: string): Promise<string> {
    await Promise.resolve(); // Satisfy async requirement
    const mapping = MODEL_MAPPINGS.find(m => m.generic === model);
    if (mapping?.openai !== undefined && typeof mapping.openai === 'string') {
      return mapping.openai;
    }
    return model;
  }
  
  async normalizeModel(model: string): Promise<string> {
    await Promise.resolve(); // Satisfy async requirement
    const mapping = MODEL_MAPPINGS.find(m => {
      if (typeof m.openai === 'string' && m.openai === model) {
        return true;
      }
      if (Array.isArray(m.aliases) && m.aliases.includes(model)) {
        return true;
      }
      return false;
    });
    if (mapping !== undefined) {
      return mapping.generic;
    }
    return model;
  }

  /**
   * Convert OpenAI message content (which can be string or array) to a plain string.
   * For array format (multimodal), extract text content and discard image data.
   */
  private extractStringContent(content: unknown): string {
    if (content === null || content === undefined) {
      return "";
    }
    if (typeof content === "string") {
      return content;
    }

    // Array format: extract text parts
    if (Array.isArray(content)) {
      const textParts: string[] = [];
      for (const part of content) {
        if (isRecord(part) && part['type'] === "text" && typeof part['text'] === "string") {
          textParts.push(part['text'] as string);
        }
      }
      return textParts.join("\n");
    }

    return "";
  }

  // ============================================================================
  // Stream Chunk Creation Methods (SSOT for OpenAI streaming format)
  // ============================================================================

  /**
   * Creates an OpenAI-compatible stream chunk for text content.
   * This is the single source of truth for OpenAI stream chunk structure.
   */
  createStreamChunk(
    id: string | null | undefined,
    model: string | null | undefined,
    contentDelta: string | null | undefined,
    finishReason: "stop" | "length" | "tool_calls" | "content_filter" | null = null,
  ): OpenAIStreamChunk {
    const chunk: OpenAIStreamChunk = {
      id: id ?? `chatcmpl-proxy-stream-${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: model ?? "proxied-backend-model",
      choices: [
        {
          index: 0,
          delta: { role: "assistant" },
          finish_reason: finishReason,
          logprobs: null,
        },
      ],
    };

    // Ensure delta.content is always a string (OpenAIStreamChunk expects string)
    const firstChoice = chunk.choices[0];
    if (firstChoice !== undefined && firstChoice !== null) {
      firstChoice.delta.content = contentDelta ?? '';

      if (finishReason === null) {
        delete firstChoice.finish_reason;
      }
    }

    return chunk;
  }

  /**
   * Creates a sequence of OpenAI-compatible stream chunks for a tool call.
   * Returns: [role chunk, tool_call chunk, finish chunk]
   */
  createToolCallStreamSequence(
    toolCall: { name: string; arguments: Record<string, unknown> | string },
    id: string | null | undefined,
    model: string | null | undefined
  ): OpenAIStreamChunk[] {
    const baseId = id ?? `chatcmpl-proxy-func-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const baseModel = model ?? "proxied-backend-model";

    const roleChunk: OpenAIStreamChunk = {
      id: baseId,
      object: "chat.completion.chunk",
      created: created,
      model: baseModel,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
          },
          finish_reason: null,
        },
      ],
    };

    const toolCallId = `call_${Date.now()}`;
    const toolCallChunk: OpenAIStreamChunk = {
      id: baseId,
      object: "chat.completion.chunk",
      created: created,
      model: baseModel,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: toolCallId,
                type: "function",
                function: {
                  name: toolCall.name,
                  arguments: typeof toolCall.arguments === 'string'
                    ? toolCall.arguments
                    : JSON.stringify(toolCall.arguments),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };

    const finishChunk: OpenAIStreamChunk = {
      id: baseId,
      object: "chat.completion.chunk",
      created: created,
      model: baseModel,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "tool_calls",
        },
      ],
    };

    return [roleChunk, toolCallChunk, finishChunk];
  }

  /**
   * Creates a final tool call chunk with finish_reason: "tool_calls".
   */
  createFinalToolCallChunk(
    id: string | null | undefined,
    model: string | null | undefined
  ): OpenAIStreamChunk {
    return {
      id: id ?? `chatcmpl-proxy-toolend-${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: model ?? "proxied-backend-model",
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "tool_calls",
          logprobs: null,
        },
      ],
    };
  }

  private toGenericStreamChoice(choice: unknown, fallbackIndex: number): GenericStreamChunk['choices'][number] {
    if (!isRecord(choice)) {
      return {
        index: fallbackIndex,
        delta: {},
      };
    }

    const record = choice as UnknownRecord;
    const deltaRaw = record['delta'];
    const delta: GenericStreamChunk['choices'][number]['delta'] = {};

    if (isRecord(deltaRaw)) {
      const roleValue = deltaRaw['role'];
      if (isGenericMessageRole(roleValue)) {
        delta.role = roleValue;
      }

      const contentValue = deltaRaw['content'];
      if (typeof contentValue === 'string') {
        delta.content = contentValue;
      } else if (contentValue === null) {
        delta.content = null;
      }

      if (typeof deltaRaw['refusal'] === 'string') {
        delta.refusal = deltaRaw['refusal'] as string;
      }

      const toolCallsRaw = deltaRaw['tool_calls'];
      if (Array.isArray(toolCallsRaw)) {
        const normalizedToolCalls = toolCallsRaw
          .map((call, index) => this.normalizeStreamToolCall(call, index))
          .filter((value): value is NonNullable<typeof value> => value !== null);

        if (normalizedToolCalls.length > 0) {
          delta.tool_calls = normalizedToolCalls;
        }
      }
    }

    const finishReason = this.normalizeFinishReason(record['finish_reason']);
    const logprobs = record['logprobs'];

    return {
      index: typeof record['index'] === 'number' ? (record['index'] as number) : fallbackIndex,
      delta,
      ...(finishReason !== undefined && { finishReason }),
      ...(logprobs !== undefined && { logprobs }),
    };
  }

  private normalizeStreamToolCall(call: unknown, fallbackIndex: number): GenericStreamToolCall | null {
    if (!isRecord(call)) {
      return null;
    }

    const callRecord = call as UnknownRecord;
    const functionRecord = callRecord['function'];

    let normalizedArguments: string | undefined;
    let normalizedName: string | undefined;
    if (isRecord(functionRecord)) {
      const argsValue = functionRecord['arguments'];
      if (typeof argsValue === 'string') {
        normalizedArguments = argsValue;
      } else if (isRecord(argsValue)) {
        normalizedArguments = JSON.stringify(argsValue);
      }

      if (typeof functionRecord['name'] === 'string') {
        normalizedName = functionRecord['name'] as string;
      }
    }

    const functionPayload: GenericStreamToolCall['function'] | undefined =
      normalizedName !== undefined || normalizedArguments !== undefined
        ? {
            ...(normalizedName !== undefined && { name: normalizedName }),
            ...(normalizedArguments !== undefined && { arguments: normalizedArguments }),
          }
        : undefined;

    const indexValue = typeof callRecord['index'] === 'number' ? (callRecord['index'] as number) : fallbackIndex;
    const idValue = typeof callRecord['id'] === 'string' ? (callRecord['id'] as string) : undefined;

    return {
      index: indexValue,
      type: 'function',
      ...(idValue !== undefined && { id: idValue }),
      ...(functionPayload !== undefined && { function: functionPayload }),
    };
  }

  private normalizeFinishReason(value: unknown): GenericStreamChunk['choices'][number]['finishReason'] | undefined {
    if (value === null) {
      return null;
    }

    if (value === undefined) {
      return undefined;
    }

    if (value === 'stop' || value === 'length' || value === 'tool_calls' || value === 'content_filter' || value === 'function_call') {
      return value;
    }

    return undefined;
  }
}
