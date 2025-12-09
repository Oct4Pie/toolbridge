/**
 * Base Provider Converter Interface
 *
 * Defines the contract that all provider converters must implement
 * for bidirectional conversion to/from the generic schema.
 */

import { hasTools } from '../utils/formatUtils.js';
import { isRecord, type UnknownRecord } from '../utils/typeGuards.js';

import type {
  CompatibilityResult,
  ConversionContext,
  GenericLLMRequest,
  GenericLLMResponse,
  GenericStreamChunk,
  LLMProvider,
  ProviderCapabilities,
} from "../types/index.js";

type ValidationResult = { valid: boolean; errors: string[] };

// Base converter interface that all providers must implement
export interface ProviderConverter {
  readonly provider: LLMProvider;
  readonly capabilities: ProviderCapabilities;

  // Request conversion methods
  toGeneric(request: unknown, context?: ConversionContext): Promise<GenericLLMRequest>;
  fromGeneric(request: GenericLLMRequest, context?: ConversionContext): Promise<unknown>;

  // Response conversion methods
  responseToGeneric(response: unknown, context?: ConversionContext): Promise<GenericLLMResponse>;
  responseFromGeneric(response: GenericLLMResponse, context?: ConversionContext): Promise<unknown>;

  // Stream chunk conversion methods
  chunkToGeneric(chunk: unknown, context?: ConversionContext): Promise<GenericStreamChunk | null>;
  chunkFromGeneric(chunk: GenericStreamChunk, context?: ConversionContext): Promise<unknown>;

  // Validation and compatibility
  validateRequest(request: unknown): Promise<ValidationResult>;
  checkCompatibility(request: GenericLLMRequest): Promise<CompatibilityResult>;

  // Provider-specific utilities
  resolveModel(model: string): Promise<string>; // Resolve generic model to provider model
  normalizeModel(model: string): Promise<string>; // Resolve provider model to generic

  // Optional: Custom parameter handling
  transformParameters?(
    params: UnknownRecord,
    direction: "toGeneric" | "fromGeneric",
  ): UnknownRecord;
}

// Abstract base class with common functionality
export abstract class BaseConverter implements ProviderConverter {
  abstract readonly provider: LLMProvider;
  abstract readonly capabilities: ProviderCapabilities;

  // Abstract methods that must be implemented
  abstract toGeneric(request: unknown, context?: ConversionContext): Promise<GenericLLMRequest>;
  abstract fromGeneric(request: GenericLLMRequest, context?: ConversionContext): Promise<unknown>;
  abstract responseToGeneric(response: unknown, context?: ConversionContext): Promise<GenericLLMResponse>;
  abstract responseFromGeneric(response: GenericLLMResponse, context?: ConversionContext): Promise<unknown>;
  abstract chunkToGeneric(chunk: unknown, context?: ConversionContext): Promise<GenericStreamChunk | null>;
  abstract chunkFromGeneric(chunk: GenericStreamChunk, context?: ConversionContext): Promise<unknown>;
  abstract resolveModel(model: string): Promise<string>;
  abstract normalizeModel(model: string): Promise<string>;

  // Default implementations
  async validateRequest(request: unknown): Promise<ValidationResult> {
    await Promise.resolve();
    const errors: string[] = [];

    if (!isRecord(request)) {
      errors.push("Request is null or undefined");
      return { valid: false, errors };
    }

    if (!Array.isArray(request['messages'])) {
      errors.push("Messages array is required");
    } else if (request['messages'].length === 0) {
      errors.push("At least one message is required");
    }

    return { valid: errors.length === 0, errors };
  }

  async checkCompatibility(request: GenericLLMRequest): Promise<CompatibilityResult> {
    await Promise.resolve();
    const warnings: string[] = [];
    const unsupportedFeatures: string[] = [];
    const transformations: Array<{ from: string; to: string; description: string }> = [];

    if (hasTools(request) && !this.capabilities.toolCalls) {
      unsupportedFeatures.push("toolCalls");
      transformations.push({
        from: "tool_calls",
        to: "text_instructions",
        description: "Tool calls will be converted to text instructions",
      });
    }

    if (request.stream === true && !this.capabilities.streaming) {
      unsupportedFeatures.push("streaming");
      warnings.push("Streaming not supported, will return complete response");
    }

    if (typeof request.n === "number" && request.n > 1 && !this.capabilities.multipleChoices) {
      unsupportedFeatures.push("multipleChoices");
      transformations.push({
        from: "n > 1",
        to: "n = 1",
        description: "Multiple choices not supported, using single response",
      });
    }

    if (request.logprobs === true && !this.capabilities.logprobs) {
      unsupportedFeatures.push("logprobs");
      warnings.push("Log probabilities not available for this provider");
    }

    if (
      request.responseFormat !== undefined
      && request.responseFormat !== "text"
      && !this.capabilities.jsonMode
    ) {
      unsupportedFeatures.push("jsonMode");
      warnings.push("JSON response format not supported, using text mode");
    }

    if (
      request.responseFormat !== undefined
      && typeof request.responseFormat === "object"
      && !this.capabilities.structuredOutputs
    ) {
      unsupportedFeatures.push("structuredOutputs");
      transformations.push({
        from: "structured_outputs",
        to: "json_mode",
        description: "Structured outputs converted to JSON mode with instructions",
      });
    }

    return {
      compatible: unsupportedFeatures.length === 0,
      warnings,
      unsupportedFeatures,
      transformations,
    };
  }

  // Utility methods for common operations
  protected createContext(sourceProvider: LLMProvider, targetProvider?: LLMProvider): ConversionContext {
    return {
      sourceProvider,
      targetProvider: targetProvider ?? this.provider,
      requestId: Math.random().toString(36).slice(2, 11),
      transformationLog: [],
    };
  }

  protected logTransformation(context: ConversionContext, step: string, description: string): void {
    if (Array.isArray(context.transformationLog)) {
      context.transformationLog.push({
        step,
        description,
        timestamp: Date.now(),
      });
    }
  }

  protected extractModelFromRequest(request: unknown): string | null {
    if (!isRecord(request)) {
      return null;
    }

    const model = request['model'];
    if (typeof model === "string" && model.trim() !== "") {
      return model;
    }

    const deployment = request['deployment'];
    if (typeof deployment === "string" && deployment.trim() !== "") {
      return deployment;
    }

    return null;
  }

  protected generateId(prefix = "chatcmpl"): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const random = Math.random().toString(36).slice(2, 14);
    return `${prefix}-${timestamp}-${random}`;
  }

  protected getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  // Parameter transformation utilities
  transformParameters(
    params: UnknownRecord,
    _direction: "toGeneric" | "fromGeneric",
  ): UnknownRecord {
    return params;
  }

  protected mapParameters(
    params: UnknownRecord,
    mapping: Record<string, string>,
    direction: "toGeneric" | "fromGeneric",
  ): UnknownRecord {
    const result: UnknownRecord = {};

    if (direction === "toGeneric") {
      for (const [providerKey, value] of Object.entries(params)) {
        const genericKey = Object.keys(mapping).find((key) => mapping[key] === providerKey);
        if (genericKey) {
          result[genericKey] = value;
        } else {
          result[providerKey] = value;
        }
      }
    } else {
      for (const [genericKey, value] of Object.entries(params)) {
        const providerKey = mapping[genericKey];
        if (providerKey) {
          result[providerKey] = value;
        } else {
          result[genericKey] = value;
        }
      }
    }

    return result;
  }
}

// Converter factory interface
export interface ConverterFactory {
  create(provider: LLMProvider, config?: UnknownRecord): Promise<ProviderConverter>;
  getAvailableProviders(): LLMProvider[];
  isSupported(provider: LLMProvider): boolean;
}

// Registry for storing converter instances
export class ConverterRegistry {
  private readonly converters = new Map<LLMProvider, ProviderConverter>();

  register(converter: ProviderConverter): void {
    this.converters.set(converter.provider, converter);
  }

  get(provider: LLMProvider): ProviderConverter | null {
    return this.converters.get(provider) ?? null;
  }

  getAll(): Map<LLMProvider, ProviderConverter> {
    return new Map(this.converters);
  }

  has(provider: LLMProvider): boolean {
    return this.converters.has(provider);
  }

  remove(provider: LLMProvider): boolean {
    return this.converters.delete(provider);
  }

  clear(): void {
    this.converters.clear();
  }

  getAvailableProviders(): LLMProvider[] {
    return Array.from(this.converters.keys());
  }
}

// Global converter registry instance
export const converterRegistry = new ConverterRegistry();

// Utility function to get converter safely
export function getConverter(provider: LLMProvider): ProviderConverter {
  const converter = converterRegistry.get(provider);
  if (!converter) {
    throw new Error(`No converter registered for provider: ${provider}`);
  }
  return converter;
}
