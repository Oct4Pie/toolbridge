/**
 * Model Format Converter
 *
 * SSOT for all model format conversions between OpenAI and Ollama.
 * Provides bi-directional translation through a universal intermediate format.
 */

import type {
  ModelConverter,
  OpenAIModel,
  OllamaModel,
  UniversalModel,
} from '../types/models.js';

/**
 * Default model converter implementation
 */
class ModelConverterImpl implements ModelConverter {
  /**
   * Convert OpenAI model to universal format
   * Supports both simple OpenAI format and enriched OpenRouter format (Datum)
   */
  fromOpenAI(model: OpenAIModel): UniversalModel {
    // Extract capabilities from model ID
    const capabilities = this.inferCapabilitiesFromModelId(model.id);

    // Handle enriched Datum type (from OpenRouter/generated types)
    // Datum has: id, name, description, context_length, canonical_slug, pricing, etc.
    const modelAny = model as any;

    if (Array.isArray(modelAny.supported_parameters) && modelAny.supported_parameters.length > 0) {
      const supportedParams = new Set<string>(modelAny.supported_parameters as string[]);
      const supportsNativeTools = supportedParams.has('tools') || supportedParams.has('tool_choice');

      // Reflect native provider capabilities. ToolBridge can still enable tools via XML,
      // but this flag indicates upstream native support (used by capability inference tests).
      capabilities.tools = supportsNativeTools;
      capabilities.functionCalling = supportsNativeTools;
    }

    const result: UniversalModel = {
      id: model.id,
      name: modelAny.name ?? model.id,
      description: modelAny.description ?? `OpenAI model: ${model.id}`,
      contextLength: modelAny.context_length ?? this.inferContextLength(model.id),
      capabilities,
      metadata: {
        ...model,
      },
    };

    // Add pricing if available
    if (modelAny.pricing) {
      result.pricing = {
        promptTokens: parseFloat(modelAny.pricing.prompt) || 0,
        completionTokens: parseFloat(modelAny.pricing.completion) || 0,
      };
    }

    return result;
  }

  /**
   * Convert Ollama model to universal format
   *
   * Note: ToolBridge enables tool calling for ALL models via XML parsing,
   * so tools and functionCalling are always true regardless of native support
   */
  fromOllama(model: OllamaModel): UniversalModel {
    const capabilities = {
      chat: true,
      completion: true,
      embedding: model.details.family?.toLowerCase().includes('embed') ?? false,
      vision: model.details.families?.some(f => f.toLowerCase().includes('vision')) ?? false,
      tools: true, // ToolBridge provides tool calling via XML translation layer
      functionCalling: true, // ToolBridge provides tool calling via XML translation layer
    };

    const parameterSize = model.details.parameter_size ?? 'Unknown';
    const quantizationLevel = model.details.quantization_level ?? 'Q4_0';

    return {
      id: model.name,
      name: model.name,
      description: `${model.details.family} - ${parameterSize}`,
      contextLength: this.parseContextLength(parameterSize),
      size: model.size,
      quantization: quantizationLevel,
      family: model.details.family,
      capabilities,
      metadata: {
        model: model.model,
        modified_at: model.modified_at,
        digest: model.digest,
        details: model.details,
      },
    };
  }

  /**
   * Convert universal model to OpenAI format (Datum)
   * Creates the enriched OpenRouter/OpenAI model structure
   */
  toOpenAI(model: UniversalModel): OpenAIModel {
    // If metadata already contains a complete Datum, return it with updates
    const metadata = model.metadata as any;
    if (metadata.canonical_slug || metadata.architecture) {
      return {
        ...metadata,
        id: model.id,
        name: model.name,
        description: model.description ?? metadata.description ?? '',
        context_length: model.contextLength ?? metadata.context_length ?? 8192,
      };
    }

    // Otherwise, synthesize a Datum structure
    return {
      id: model.id,
      canonical_slug: model.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
      hugging_face_id: null,
      name: model.name,
      created: (metadata.created as number) ?? Date.now(),
      description: model.description ?? `Model: ${model.name}`,
      context_length: model.contextLength ?? 8192,
      architecture: {
        modality: 'text->text' as any,
        input_modalities: ['text'] as any,
        output_modalities: ['text'] as any,
        tokenizer: 'Other' as any,
        instruct_type: null,
      },
      pricing: {
        prompt: model.pricing?.promptTokens?.toString() ?? '0',
        completion: model.pricing?.completionTokens?.toString() ?? '0',
      },
      top_provider: {
        context_length: model.contextLength ?? null,
        max_completion_tokens: null,
        is_moderated: false,
      },
      per_request_limits: null,
      supported_parameters: [],
      default_parameters: null,
    } as OpenAIModel;
  }

  /**
   * Convert universal model to Ollama format
   */
  toOllama(model: UniversalModel): OllamaModel {
    const now = new Date().toISOString();

    // Extract metadata values with proper typing
    const metadata = model.metadata;
    const modifiedAt = metadata['modified_at'] as string | undefined;
    const digest = metadata['digest'] as string | undefined;
    const parentModel = metadata['parent_model'] as string | undefined;

    // Extract family and size from model name or metadata
    const family = model.family ?? this.inferFamily(model.id);
    const parameterSize = this.inferParameterSize(model.id, model.contextLength);

    // Build capabilities list from model capabilities
    // Note: ToolBridge's XML parsing layer enables tool calling for ALL models,
    // so 'tools' will always be present for chat/completion models
    const capabilityList: string[] = [];
    capabilityList.push('tools');
    if (model.capabilities.chat) {
      capabilityList.push('chat');
    }
    if (model.capabilities.completion) {
      capabilityList.push('completion');
    }
   
    if (model.capabilities.functionCalling) {
      capabilityList.push('function_calling');
    }
    if (model.capabilities.embedding) {
      capabilityList.push('embedding');
    }
    if (model.capabilities.vision) {
      capabilityList.push('vision');
    }

    return {
      name: model.name,
      model: model.id,
      modified_at: modifiedAt ?? now,
      size: model.size ?? this.estimateSize(parameterSize),
      digest: digest ?? this.generateDigest(model.id),
      details: {
        parent_model: parentModel,
        format: 'gguf',
        family,
        families: [family],
        parameter_size: parameterSize,
        quantization_level: model.quantization ?? 'Q4_0',
      },
      capabilities: capabilityList,
    };
  }

  /**
   * Infer capabilities from OpenAI model ID
   *
   * Note: ToolBridge enables tool calling for ALL models via XML parsing,
   * so tools are always enabled for non-embedding models
   */
  private inferCapabilitiesFromModelId(modelId: string): UniversalModel['capabilities'] {
    const lowerModelId = modelId.toLowerCase();
    const isEmbeddingModel = lowerModelId.includes('embed');

    return {
      chat: !isEmbeddingModel,
      completion: !isEmbeddingModel,
      embedding: isEmbeddingModel,
      vision: lowerModelId.includes('vision') || lowerModelId.includes('gpt-4'),
      tools: !isEmbeddingModel, // ToolBridge provides tool calling via XML translation layer
      functionCalling: !isEmbeddingModel, // ToolBridge provides tool calling via XML translation layer
    };
  }

  /**
   * Infer context length from model ID
   */
  private inferContextLength(modelId: string): number {
    const lowerModelId = modelId.toLowerCase();

    // Check for explicit context indicators
    if (lowerModelId.includes('128k')) {return 128000;}
    if (lowerModelId.includes('32k')) {return 32000;}
    if (lowerModelId.includes('16k')) {return 16000;}
    if (lowerModelId.includes('8k')) {return 8000;}

    // Model-specific defaults
    if (lowerModelId.includes('gpt-4')) {return 8192;}
    if (lowerModelId.includes('gpt-3.5')) {return 4096;}
    if (lowerModelId.includes('claude')) {
      if (lowerModelId.includes('claude-3')) {return 200000;}
      return 100000;
    }

    // Default fallback
    return 8192;
  }

  /**
   * Parse context length from parameter size string
   */
  private parseContextLength(parameterSize: string): number {
    // Extract number from strings like "7B", "13B", "70B"
    const match = parameterSize.match(/(\d+)B/i);
    if (match?.[1]) {
      const billions = parseInt(match[1], 10);
      // Rough estimate: larger models often have larger context
      if (billions >= 70) {return 32768;}
      if (billions >= 30) {return 16384;}
      if (billions >= 13) {return 8192;}
      return 4096;
    }
    return 8192;
  }

  /**
   * Infer model family from model ID
   */
  private inferFamily(modelId: string): string {
    const lowerModelId = modelId.toLowerCase();

    if (lowerModelId.includes('gpt')) {return 'gpt';}
    if (lowerModelId.includes('claude')) {return 'claude';}
    if (lowerModelId.includes('llama')) {return 'llama';}
    if (lowerModelId.includes('mistral')) {return 'mistral';}
    if (lowerModelId.includes('gemma')) {return 'gemma';}
    if (lowerModelId.includes('qwen')) {return 'qwen';}
    if (lowerModelId.includes('deepseek')) {return 'deepseek';}

    return 'unknown';
  }

  /**
   * Infer parameter size from model ID and context length
   */
  private inferParameterSize(modelId: string, contextLength?: number): string {
    const lowerModelId = modelId.toLowerCase();

    // Try to extract from model name
    const match = lowerModelId.match(/(\d+)b/i);
    if (match) {
      return `${match[1]}B`;
    }

    // Estimate from model family
    if (lowerModelId.includes('gpt-4')) {return '175B';}
    if (lowerModelId.includes('gpt-3.5')) {return '20B';}
    if (lowerModelId.includes('claude-3')) {return '200B';}

    // Estimate from context length
    if (contextLength !== undefined) {
      if (contextLength >= 100000) {return '70B';}
      if (contextLength >= 32000) {return '34B';}
      if (contextLength >= 16000) {return '13B';}
    }

    return '7B';
  }

  /**
   * Estimate model size in bytes from parameter size
   */
  private estimateSize(parameterSize: string): number {
    const match = parameterSize.match(/(\d+)B/i);
    if (match?.[1]) {
      const billions = parseInt(match[1], 10);
      // Rough estimate: ~2 bytes per parameter (Q4 quantization)
      return billions * 1_000_000_000 * 2;
    }
    return 7_000_000_000; // 7GB default
  }

  /**
   * Generate a pseudo-digest for model
   */
  private generateDigest(modelId: string): string {
    // Simple hash-like string based on model ID
    const hash = Buffer.from(modelId).toString('base64').substring(0, 12);
    return `sha256:${hash}${'0'.repeat(52)}`;
  }
}

/**
 * Singleton instance
 */
export const modelConverter = new ModelConverterImpl();
