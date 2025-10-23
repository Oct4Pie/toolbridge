/**
 * Azure Provider Converter
 *
 * Handles conversion between Azure OpenAI API format and the generic schema.
 */

import { MODEL_MAPPINGS, PROVIDER_CAPABILITIES } from "../types/providers.js";

import { BaseConverter } from "./base.js";

import type {
  ConversionContext,
  GenericLLMRequest,
  GenericLLMResponse,
  GenericStreamChunk,
  GenericResponseFormat,
  LLMProvider,
  ProviderCapabilities,
} from "../types/index.js";

type AzureMessages = GenericLLMRequest["messages"];
type AzureTools = GenericLLMRequest["tools"];
type AzureToolChoice = GenericLLMRequest["toolChoice"];
type AzureStop = GenericLLMRequest["stop"];
interface AzureStreamOptions {
  include_usage?: boolean;
}
type AzureResponseFormat = { type?: string } | string;

interface AzureUsagePayload {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface AzureChatCompletionsRequest {
  model?: string;
  deployment?: string;
  messages?: AzureMessages;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  stop?: AzureStop;
  tools?: AzureTools;
  tool_choice?: AzureToolChoice;
  parallel_tool_calls?: boolean;
  response_format?: AzureResponseFormat;
  stream?: boolean;
  stream_options?: AzureStreamOptions;
  n?: number;
  dataSources?: unknown;
  data_sources?: unknown;
  enhancements?: unknown;
}

interface AzureChatCompletionsResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices?: GenericLLMResponse["choices"];
  usage?: AzureUsagePayload;
  system_fingerprint?: string;
}

interface AzureChatStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices?: GenericStreamChunk["choices"];
  usage?: AzureUsagePayload;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function ensureAzureChatRequest(value: unknown): AzureChatCompletionsRequest {
  if (!isRecord(value)) {
    throw new Error("Azure request payload must be an object");
  }
  return value as AzureChatCompletionsRequest;
}

function ensureAzureChatResponse(value: unknown): AzureChatCompletionsResponse {
  if (!isRecord(value)) {
    throw new Error("Azure response payload must be an object");
  }
  
  // Validate and extract required fields
  if (typeof value.id !== 'string') {
    throw new Error("Azure response must have 'id' string field");
  }
  if (typeof value.object !== 'string') {
    throw new Error("Azure response must have 'object' string field");
  }
  if (typeof value.created !== 'number') {
    throw new Error("Azure response must have 'created' number field");
  }
  if (typeof value.model !== 'string') {
    throw new Error("Azure response must have 'model' string field");
  }
  
  // Build properly typed object
  const response: AzureChatCompletionsResponse = {
    id: value.id,
    object: value.object,
    created: value.created,
    model: value.model,
    choices: Array.isArray(value.choices) ? value.choices as GenericLLMResponse["choices"] : undefined,
    usage: value.usage as AzureUsagePayload | undefined,
    system_fingerprint: typeof value.system_fingerprint === 'string' ? value.system_fingerprint : undefined,
  };
  
  return response;
}

function ensureAzureStreamChunk(value: unknown): AzureChatStreamChunk {
  if (!isRecord(value)) {
    throw new Error("Azure stream chunk must be an object");
  }
  
  // Validate and extract required fields
  if (typeof value.id !== 'string') {
    throw new Error("Azure stream chunk must have 'id' string field");
  }
  if (typeof value.object !== 'string') {
    throw new Error("Azure stream chunk must have 'object' string field");
  }
  if (typeof value.created !== 'number') {
    throw new Error("Azure stream chunk must have 'created' number field");
  }
  if (typeof value.model !== 'string') {
    throw new Error("Azure stream chunk must have 'model' string field");
  }
  
  // Build properly typed object
  const chunk: AzureChatStreamChunk = {
    id: value.id,
    object: value.object,
    created: value.created,
    model: value.model,
    choices: Array.isArray(value.choices) ? value.choices as GenericStreamChunk["choices"] : undefined,
    usage: value.usage as AzureUsagePayload | undefined,
  };
  
  return chunk;
}

function removeUndefined<T>(input: T): T {
  if (typeof input !== 'object' || input === null) {
    return input;
  }
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as T;
}

const normalizeModel = (value: string | undefined, fallback: string): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed === "" ? fallback : value;
};

const optionalString = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : value;
};

export class AzureConverter extends BaseConverter {
  readonly provider: LLMProvider = "azure";
  readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.azure;

  async toGeneric(request: unknown, _context?: ConversionContext): Promise<GenericLLMRequest> {
    const azureRequest = ensureAzureChatRequest(request);
    await Promise.resolve();
    const deployment = this.extractDeploymentFromRequest(azureRequest);
    const responseFormat = azureRequest.response_format;
    
    // Resolve response format to GenericResponseFormat
    let resolvedResponseFormat: GenericResponseFormat | undefined;
    if (responseFormat === undefined) {
      resolvedResponseFormat = undefined;
    } else if (typeof responseFormat === 'string') {
      // Convert string format to valid GenericResponseFormat
      resolvedResponseFormat = responseFormat === 'json' ? 'json_object' : 'text';
    } else if (typeof responseFormat === 'object' && responseFormat !== null) {
      const fmt = responseFormat as Record<string, unknown>;
      if (fmt.type === 'json_schema' && 'json_schema' in fmt) {
        resolvedResponseFormat = responseFormat as GenericResponseFormat;
      } else {
        resolvedResponseFormat = undefined;
      }
    } else {
      resolvedResponseFormat = undefined;
    }

    const dataSources = (azureRequest.dataSources ?? azureRequest.data_sources) as unknown[] | undefined;
    const { enhancements } = azureRequest;

    const extensions = 
      (Array.isArray(dataSources) && dataSources.length > 0) || enhancements !== undefined
        ? {
            azure: {
              ...(Array.isArray(dataSources) && dataSources.length > 0 && { dataSources }),
              ...(enhancements !== undefined && { enhancements }),
            },
          }
        : undefined;

    const streamOptions =
      azureRequest.stream_options !== undefined
        ? {
            includeUsage: azureRequest.stream_options.include_usage,
          }
        : undefined;

    const genericRequest: GenericLLMRequest = {
      provider: "azure",
      model: normalizeModel(azureRequest.model, "gpt-4o"),
      ...(deployment !== undefined && { deployment }),
      messages: azureRequest.messages ?? [],
      maxTokens: azureRequest.max_tokens,
      temperature: azureRequest.temperature,
      topP: azureRequest.top_p,
      presencePenalty: azureRequest.presence_penalty,
      frequencyPenalty: azureRequest.frequency_penalty,
      seed: azureRequest.seed,
      stop: azureRequest.stop,
      tools: azureRequest.tools,
      toolChoice: azureRequest.tool_choice,
      parallelToolCalls: azureRequest.parallel_tool_calls,
      responseFormat: resolvedResponseFormat,
      stream: azureRequest.stream,
      streamOptions,
      n: azureRequest.n,
      ...(extensions !== undefined && { extensions }),
    };

    return genericRequest;
  }

  async fromGeneric(
    request: GenericLLMRequest,
    _context?: ConversionContext,
  ): Promise<AzureChatCompletionsRequest> {
    await Promise.resolve();
    const azureRequest: AzureChatCompletionsRequest = {
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

    const responseFormat = request.responseFormat;
    if (responseFormat !== undefined) {
      azureRequest.response_format =
        typeof responseFormat === "string" ? { type: responseFormat } : responseFormat;
    }

    if (request.streamOptions?.includeUsage !== undefined) {
      azureRequest.stream_options = {
        include_usage: request.streamOptions.includeUsage,
      };
    }

    const azureExtensions = request.extensions?.azure;
    if (azureExtensions) {
      if (azureExtensions.dataSources !== undefined) {
        azureRequest.dataSources = azureExtensions.dataSources;
      }
      if (azureExtensions.enhancements !== undefined) {
        azureRequest.enhancements = azureExtensions.enhancements;
      }
    }

    return removeUndefined(azureRequest);
  }

  async responseToGeneric(
    response: unknown,
    _context?: ConversionContext,
  ): Promise<GenericLLMResponse> {
    await Promise.resolve();
    const azureResponse = ensureAzureChatResponse(response);
    const usagePayload = azureResponse.usage;
    const usage =
      usagePayload !== undefined
        ? {
            promptTokens: usagePayload.prompt_tokens ?? 0,
            completionTokens: usagePayload.completion_tokens ?? 0,
            totalTokens: usagePayload.total_tokens ?? 0,
          }
        : undefined;

    const genericResponse: GenericLLMResponse = {
      id: azureResponse.id,
      object: 'chat.completion',
      created: azureResponse.created,
      model: azureResponse.model,
      provider: "azure",
      choices: azureResponse.choices ?? [],
      ...(usage !== undefined && { usage }),
      systemFingerprint: azureResponse.system_fingerprint,
    };

    return genericResponse;
  }

  async responseFromGeneric(
    response: GenericLLMResponse,
    _context?: ConversionContext,
  ): Promise<AzureChatCompletionsResponse> {
    await Promise.resolve();
    const usagePayload = response.usage
      ? {
          prompt_tokens: response.usage.promptTokens,
          completion_tokens: response.usage.completionTokens,
          total_tokens: response.usage.totalTokens,
        }
      : undefined;

    const azureResponse: AzureChatCompletionsResponse = {
      id: response.id,
      object: "chat.completion",
      created: response.created,
      model: response.model,
      choices: response.choices,
      ...(usagePayload !== undefined && { usage: usagePayload }),
      system_fingerprint: response.systemFingerprint,
    };

    return azureResponse;
  }

  async chunkToGeneric(
    chunk: unknown,
    _context?: ConversionContext,
  ): Promise<GenericStreamChunk | null> {
    await Promise.resolve();
    if (!isRecord(chunk)) {
      return null;
    }

    const azureChunk = ensureAzureStreamChunk(chunk);
    const usagePayload = azureChunk.usage;
    const usage =
      usagePayload !== undefined
        ? {
            promptTokens: usagePayload.prompt_tokens ?? 0,
            completionTokens: usagePayload.completion_tokens ?? 0,
            totalTokens: usagePayload.total_tokens ?? 0,
          }
        : undefined;

    const genericChunk: GenericStreamChunk = {
      id: azureChunk.id,
      object: "chat.completion.chunk",
      created: azureChunk.created,
      model: azureChunk.model,
      provider: "azure",
      choices: azureChunk.choices ?? [],
      ...(usage !== undefined && { usage }),
    };

    return genericChunk;
  }

  async chunkFromGeneric(
    chunk: GenericStreamChunk,
    _context?: ConversionContext,
  ): Promise<AzureChatStreamChunk> {
    await Promise.resolve();
    const usagePayload = chunk.usage
      ? {
          prompt_tokens: chunk.usage.promptTokens,
          completion_tokens: chunk.usage.completionTokens,
          total_tokens: chunk.usage.totalTokens,
        }
      : undefined;

    const azureChunk: AzureChatStreamChunk = {
      id: chunk.id,
      object: "chat.completion.chunk",
      created: chunk.created,
      model: chunk.model,
      choices: chunk.choices,
      ...(usagePayload !== undefined && { usage: usagePayload }),
    };

    return azureChunk;
  }

  async resolveModel(model: string): Promise<string> {
    await Promise.resolve();
    const mapping = MODEL_MAPPINGS.find((entry) => entry.generic === model);
    if (mapping?.azure && mapping.azure.length > 0) {
      return mapping.azure[0];
    }
    return model;
  }

  async normalizeModel(deploymentOrModel: string): Promise<string> {
    await Promise.resolve();
    const mapping = MODEL_MAPPINGS.find((entry) => {
      const matchesDeployment = entry.azure?.includes(deploymentOrModel) === true;
      const matchesGeneric = entry.generic === deploymentOrModel;
      return matchesDeployment || matchesGeneric;
    });
    if (mapping) {
      return mapping.generic;
    }
    return deploymentOrModel;
  }

  private extractDeploymentFromRequest(request: AzureChatCompletionsRequest): string | undefined {
    const deployment = optionalString(request.deployment);
    if (deployment !== undefined) {
      return deployment;
    }
    return optionalString(request.model);
  }
}
