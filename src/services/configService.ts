/**
 * Configuration Service Implementation
 * 
 * SSOT for all configuration. Environment variables are read ONCE at startup.
 * All config access MUST go through this service.
 */

import {
  BACKEND_LLM_BASE_URL,
  BACKEND_LLM_API_KEY,
  BACKEND_MODE,
  OPENAI_BACKEND_URL,
  OLLAMA_BACKEND_URL,
  PROXY_PORT,
  PROXY_HOST,
  DEBUG_MODE,
  ENABLE_TOOL_REINJECTION,
  TOOL_REINJECTION_MESSAGE_COUNT,
  TOOL_REINJECTION_TOKEN_COUNT,
  TOOL_REINJECTION_TYPE,
  PASS_TOOLS,
  SERVING_MODE,
} from '../config.js';

import type { ConfigService } from './contracts.js';

class ConfigServiceImpl implements ConfigService {
  getBackendUrl(): string {
    return BACKEND_LLM_BASE_URL;
  }

  getBackendApiKey(): string {
    return BACKEND_LLM_API_KEY;
  }

  getBackendMode(): 'openai' | 'ollama' {
    // Backend mode is always explicitly set, validated at startup
    return BACKEND_MODE;
  }

  getServingMode(): 'openai' | 'ollama' {
    // Serving mode is always explicitly set, validated at startup
    return SERVING_MODE;
  }

  getOpenAIBackendUrl(): string {
    return OPENAI_BACKEND_URL;
  }

  getOllamaBackendUrl(): string {
    return OLLAMA_BACKEND_URL;
  }

  /**
   * Get the explicitly configured backend for this deployment.
   * Backend mode is NEVER 'auto' - it must be explicitly set by the operator.
   * Returns the configured backend; no auto-detection is performed.
   */
  detectBackendForModel(): 'openai' | 'ollama' {
    // Backend mode is explicitly set, always return it
    return this.getBackendMode();
  }

  getProxyPort(): number {
    return PROXY_PORT;
  }

  getProxyHost(): string {
    return PROXY_HOST;
  }

  isDebugMode(): boolean {
    return DEBUG_MODE;
  }

  shouldPassTools(): boolean {
    return PASS_TOOLS;
  }

  getToolReinjectionConfig(): {
    enabled: boolean;
    messageCount: number;
    tokenCount: number;
    type: 'system' | 'user';
  } {
    return {
      enabled: ENABLE_TOOL_REINJECTION,
      messageCount: TOOL_REINJECTION_MESSAGE_COUNT,
      tokenCount: TOOL_REINJECTION_TOKEN_COUNT,
      type: TOOL_REINJECTION_TYPE,
    };
  }
}

export const configService = new ConfigServiceImpl();
