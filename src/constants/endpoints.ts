/**
 * API Endpoint Constants - SSOT for all API routes
 *
 * This file defines all API endpoint paths in ONE place to prevent duplication
 * and ensure consistency across the codebase.
 *
 * SSOT Principle: All endpoint references must import from this file.
 */

/**
 * Ollama API Endpoints
 * https://github.com/ollama/ollama/blob/main/docs/api.md
 */
export const OLLAMA_ENDPOINTS = {
  /** Chat completions endpoint */
  CHAT: '/api/chat',

  /** Text generation endpoint */
  GENERATE: '/api/generate',

  /** List all available models */
  TAGS: '/api/tags',

  /** Show model information */
  SHOW: '/api/show',

  /** Pull a model from registry */
  PULL: '/api/pull',

  /** Push a model to registry */
  PUSH: '/api/push',

  /** Create a model from Modelfile */
  CREATE: '/api/create',

  /** Delete a model */
  DELETE: '/api/delete',

  /** Copy a model */
  COPY: '/api/copy',

  /** Get Ollama version */
  VERSION: '/api/version',
} as const;

/**
 * OpenAI API Endpoints
 * https://platform.openai.com/docs/api-reference
 */
export const OPENAI_ENDPOINTS = {
  /** Chat completions endpoint */
  CHAT_COMPLETIONS: '/v1/chat/completions',

  /** List models */
  MODELS: '/v1/models',

  /** Get model info */
  MODEL_INFO: (modelId: string) => `/v1/models/${modelId}`,

  /** Embeddings */
  EMBEDDINGS: '/v1/embeddings',

  /** Legacy completions */
  COMPLETIONS: '/v1/completions',
} as const;

/**
 * ToolBridge Internal Endpoints
 */
export const TOOLBRIDGE_ENDPOINTS = {
  /** Health check */
  HEALTH: '/',

  /** Root documentation */
  DOCS: '/',
} as const;
