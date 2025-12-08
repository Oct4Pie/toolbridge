/**
 * Model Translation Types
 *
 * SSOT Strategy: Use generated types from src/types/generated/
 * This file provides type aliases and the universal intermediate format.
 */

import type { Model as GeneratedOllamaModel } from '../../types/generated/ollama/tags.js';
import type { Datum } from '../../types/generated/openai/models-list.js';

// ============================================================
// GENERATED TYPES (SSOT) - Re-export with aliases
// ============================================================

/**
 * OpenAI model format (from /v1/models endpoint)
 * Uses generated Datum type which represents a single OpenAI model
 */
export type { Datum as OpenAIModel } from '../../types/generated/openai/models-list.js';

/**
 * OpenAI models list response
 * Extended from generated ModelsListResponse to include 'object' field for OpenAI API compatibility
 */
export interface OpenAIModelsResponse {
  object: string; // OpenAI API always includes 'object': 'list'
  data: Datum[]; // Array of OpenAI models
}

/**
 * Ollama model format (from /api/tags endpoint)
 * Uses generated Model type, extended with ToolBridge capabilities
 */
export interface OllamaModel extends GeneratedOllamaModel {
  capabilities?: string[]; // ToolBridge enhancement: indicate model capabilities
}

export type { TagsResponse as OllamaModelsResponse } from '../../types/generated/ollama/tags.js';

/**
 * Ollama model info (from /api/show endpoint)
 * Uses generated ShowResponse type which represents detailed model information
 */
export type { ShowResponse as OllamaModelInfo } from '../../types/generated/ollama/show.js';

// ============================================================
// INTERNAL UNIVERSAL FORMAT (not generated - ToolBridge specific)
// ============================================================

/**
 * Universal model representation (intermediate format)
 * This is ToolBridge's internal format for model translation
 */
export interface UniversalModel {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
  size?: number;
  quantization?: string;
  family?: string;
  capabilities: {
    chat: boolean;
    completion: boolean;
    embedding: boolean;
    vision: boolean;
    tools: boolean;
    functionCalling: boolean;
  };
  pricing?: {
    promptTokens?: number;
    completionTokens?: number;
  };
  metadata: Record<string, unknown>;
}

// ============================================================
// MODEL CONVERTER INTERFACE
// ============================================================

/**
 * Model converter interface
 * Defines bidirectional conversion between OpenAI, Ollama, and Universal formats
 * Uses the type aliases defined above (OpenAIModel, OllamaModel)
 */
export interface ModelConverter {
  /**
   * Convert OpenAI model to universal format
   */
  fromOpenAI(model: Datum): UniversalModel;

  /**
   * Convert Ollama model to universal format
   */
  fromOllama(model: OllamaModel): UniversalModel;

  /**
   * Convert universal model to OpenAI format
   */
  toOpenAI(model: UniversalModel): Datum;

  /**
   * Convert universal model to Ollama format
   */
  toOllama(model: UniversalModel): OllamaModel;
}
