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
  PROXY_PORT,
  PROXY_HOST,
  DEBUG_MODE,
  ENABLE_TOOL_REINJECTION,
  TOOL_REINJECTION_MESSAGE_COUNT,
  TOOL_REINJECTION_TOKEN_COUNT,
  TOOL_REINJECTION_TYPE,
  PASS_TOOLS,
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
    const mode = BACKEND_MODE;
    if (mode === 'openai' || mode === 'ollama') {
      return mode;
    }
    return 'openai'; // Default fallback
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
