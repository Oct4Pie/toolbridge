/**
 * Ollama Converter - Main Orchestrator
 *
 * Coordinates all Ollama conversion operations by delegating to specialized converters.
 * This file maintains KISS principle (<150 lines) by delegating to focused modules.
 */

import { PROVIDER_CAPABILITIES } from '../../types/providers.js';
import { createConversionContext } from '../../utils/contextFactory.js';
import { extractToolNames, isToolsEmpty } from '../../utils/formatUtils.js';
import { BaseConverter } from '../base.js';

import {
  generateId,
  parseOllamaTimestamp,
  extractOllamaExtensions,
  normalizeOllamaToolCalls,
  resolveModel,
  normalizeModel,
} from './OllamaHelpers.js';
import { OllamaRequestConverter } from './OllamaRequestConverter.js';
import { OllamaResponseConverter } from './OllamaResponseConverter.js';
import { OllamaStreamConverter } from './OllamaStreamConverter.js';
import { OllamaToolHandler } from './OllamaToolHandler.js';

import type {
  ConversionContext,
  GenericLLMRequest,
  GenericLLMResponse,
  GenericStreamChunk,
  LLMProvider,
  ProviderCapabilities,
} from '../../types/index.js';

/**
 * Ollama Provider Converter - Strict TypeScript Version
 *
 * Handles conversion between Ollama API format and the generic schema.
 * Follows ultra-strict typing patterns with no `any`, no `||`, no non-null assertions.
 */
export class OllamaConverter extends BaseConverter {
  readonly provider: LLMProvider = 'ollama';
  readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.ollama;

  private requestConverter: OllamaRequestConverter;
  private responseConverter: OllamaResponseConverter;
  private streamConverter: OllamaStreamConverter;
  private toolHandler: OllamaToolHandler;

  constructor() {
    super();
    this.requestConverter = new OllamaRequestConverter();
    this.responseConverter = new OllamaResponseConverter();
    this.streamConverter = new OllamaStreamConverter();
    this.toolHandler = new OllamaToolHandler();
  }

  // Request conversion: Ollama → Generic
  async toGeneric(request: unknown, context?: ConversionContext): Promise<GenericLLMRequest> {
    const ctx = context ?? createConversionContext(this.provider, this.provider);
    return this.requestConverter.toGeneric(
      request,
      extractOllamaExtensions,
      this.logTransformation.bind(this),
      ctx
    );
  }

  // Request conversion: Generic → Ollama
  async fromGeneric(request: GenericLLMRequest, context?: ConversionContext): Promise<unknown> {
    const ctx = context ?? createConversionContext(this.provider, this.provider);

    const ollamaRequest = await this.requestConverter.fromGeneric(
      request,
      resolveModel,
      this.logTransformation.bind(this),
      ctx
    );

    // Handle tool instructions for Ollama
    if (!isToolsEmpty(request.tools)) {
      const tools = request.tools ?? [];
      if (!Array.isArray(ctx.knownToolNames) || ctx.knownToolNames.length === 0) {
        ctx.knownToolNames = extractToolNames(tools);
      }
      ctx.enableXMLToolParsing = ctx.enableXMLToolParsing ?? true;

      // Handle PASS_TOOLS configuration - keep tool fields if enabled
      if (ctx.passTools === true) {
        this.logTransformation(ctx, 'ollama_pass_tools', 'Keeping native tool fields in Ollama payload');
        // Convert tools to Ollama format (if Ollama supports native tools in future)
        // For now, we still inject XML instructions even when passing tools
      }

      // Inject tool instructions into system message
      this.toolHandler.injectToolInstructions(
        ollamaRequest,
        tools,
        this.logTransformation.bind(this),
        ctx
      );

      // Ensure Ollama template signals tool capability
      const templateBase = typeof ollamaRequest.template === 'string'
        ? ollamaRequest.template
        : '{{system}}\n{{user}}\n{{assistant}}';
      if (!templateBase.includes('ToolCalls')) {
        ollamaRequest.template = `${templateBase} ToolCalls`;
      } else {
        ollamaRequest.template = templateBase;
      }
    }

    return ollamaRequest;
  }

  // Response conversion: Ollama → Generic
  async responseToGeneric(response: unknown, context?: ConversionContext): Promise<GenericLLMResponse> {
    const ctx = context ?? createConversionContext(this.provider, this.provider);
    return this.responseConverter.toGeneric(
      response,
      normalizeOllamaToolCalls,
      generateId,
      parseOllamaTimestamp,
      this.logTransformation.bind(this),
      ctx
    );
  }

  // Response conversion: Generic → Ollama
  async responseFromGeneric(response: GenericLLMResponse, context?: ConversionContext): Promise<unknown> {
    const ctx = context ?? createConversionContext(this.provider, this.provider);
    return this.responseConverter.fromGeneric(
      response,
      this.logTransformation.bind(this),
      ctx
    );
  }

  // Stream chunk conversion: Ollama → Generic
  async chunkToGeneric(chunk: unknown, context?: ConversionContext): Promise<GenericStreamChunk | null> {
    const ctx = context ?? createConversionContext(this.provider, this.provider);
    return this.streamConverter.chunkToGeneric(
      chunk,
      normalizeOllamaToolCalls,
      generateId,
      parseOllamaTimestamp,
      this.logTransformation.bind(this),
      ctx
    );
  }

  // Stream chunk conversion: Generic → Ollama
  async chunkFromGeneric(chunk: GenericStreamChunk, context?: ConversionContext): Promise<unknown> {
    const ctx = context ?? createConversionContext(this.provider, this.provider);
    return this.streamConverter.chunkFromGeneric(
      chunk,
      this.logTransformation.bind(this),
      ctx
    );
  }

  // Model resolution methods
  async resolveModel(model: string): Promise<string> {
    return resolveModel(model);
  }

  async normalizeModel(model: string): Promise<string> {
    return normalizeModel(model);
  }
}

// Export singleton instance
export const ollamaConverter = new OllamaConverter();
