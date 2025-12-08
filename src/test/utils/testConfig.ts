import "dotenv/config";
import { testConfigLoader } from './testConfigLoader.js';

/**
 * Unified test configuration interface
 * Wraps the testing section from config.json for backward compatibility
 * Also exposes the full nested structure for tests that need granular access
 */
interface TestConfig {
  PROXY_PORT: number;
  PROXY_HOST: string;
  MOCK_PORT: number;
  TEST_MODEL: string;
  TEST_MODEL_OLLAMA?: string;
  TEST_API_KEY: string;
  // Full nested config structure for tests that need it
  server: {
    proxyPort: number;
    proxyHost: string;
    portRangeStart: number;
    portRangeEnd: number;
  };
  mockServers: {
    openaiPort: number;
    ollamaPort: number;
    defaultResponseDelay: number;
  };
  models: {
    openaiCompatible: string;
    ollama: string;
    fallbacks: {
      openaiCompatible: string;
      ollama: string;
    };
  };
  backends: {
    openaiCompatibleUrl: string;
    ollamaUrl: string;
  };
  timeouts: {
    standard: number;
    connection: number;
    socket: number;
    portWait: number;
  };
  features: {
    enableStreamTesting: boolean;
    enableToolCalling: boolean;
    enableDualClient: boolean;
    concurrentTestLimit: number;
  };
}

// Load config from SSOT
const config = testConfigLoader.getConfig();

/**
 * Unified TEST_CONFIG object that wraps the testing configuration
 * All values come from testConfigLoader (config.json + environment variables)
 * This maintains backward compatibility while consuming from SSOT
 */
export const TEST_CONFIG: TestConfig = {
  PROXY_PORT: config.server.proxyPort,
  PROXY_HOST: config.server.proxyHost,
  MOCK_PORT: config.mockServers.openaiPort,
  TEST_MODEL: config.models.openaiCompatible,
  TEST_MODEL_OLLAMA: config.models.ollama,
  TEST_API_KEY: process.env['TEST_API_KEY'] ?? 'dummy-key',
  // Expose full nested structure
  server: config.server,
  mockServers: config.mockServers,
  models: config.models,
  backends: config.backends,
  timeouts: config.timeouts,
  features: config.features,
};

/**
 * New exports for explicit model and timeout access
 * Consumers can use these for clarity without hardcoded variable names
 */
export const TEST_MODEL_OPENAI_COMPATIBLE = config.models.openaiCompatible;
export const TEST_MODEL_OLLAMA = config.models.ollama;
export const TEST_MODEL_OPENAI_COMPATIBLE_FALLBACK = config.models.fallbacks.openaiCompatible;
export const TEST_MODEL_OLLAMA_FALLBACK = config.models.fallbacks.ollama;

/**
 * Export proxy configuration explicitly
 */
export const PROXY_PORT = config.server.proxyPort;
export const PROXY_HOST = config.server.proxyHost;

/**
 * Export mock server ports explicitly
 */
export const MOCK_OPENAI_PORT = config.mockServers.openaiPort;
export const MOCK_OLLAMA_PORT = config.mockServers.ollamaPort;

/**
 * Export timeout configuration
 */
export const TEST_TIMEOUT_STANDARD = config.timeouts.standard;
export const TEST_TIMEOUT_CONNECTION = config.timeouts.connection;
export const TEST_TIMEOUT_SOCKET = config.timeouts.socket;
export const TEST_TIMEOUT_PORT_WAIT = config.timeouts.portWait;

/**
 * Export backend URLs
 */
export const TEST_BACKEND_OPENAI_COMPATIBLE_URL = config.backends.openaiCompatibleUrl;
export const TEST_BACKEND_OLLAMA_URL = config.backends.ollamaUrl;

/**
 * Export feature flags
 */
export const TEST_FEATURES_STREAM = config.features.enableStreamTesting;
export const TEST_FEATURES_TOOL_CALLING = config.features.enableToolCalling;
export const TEST_FEATURES_DUAL_CLIENT = config.features.enableDualClient;
export const TEST_CONCURRENT_LIMIT = config.features.concurrentTestLimit;

/**
 * Build proxy URL with optional subpath
 * @param subpath Optional path to append (e.g., "/chat/completions")
 * @returns Full proxy URL
 */
export function getProxyUrl(subpath: string = ""): string {
  const formattedPath = subpath ? (subpath.startsWith("/") ? subpath : `/${subpath}`) : "";
  return `http://${config.server.proxyHost}:${config.server.proxyPort}${formattedPath}`;
}

/**
 * Build mock OpenAI server URL with optional subpath
 * @param subpath Optional path to append (e.g., "/chat/completions")
 * @returns Full mock server URL
 */
export function getMockServerUrl(subpath: string = ""): string {
  const formattedPath = subpath ? (subpath.startsWith("/") ? subpath : `/${subpath}`) : "";
  return `http://localhost:${config.mockServers.openaiPort}${formattedPath}`;
}

/**
 * Build mock Ollama server URL with optional subpath
 * @param subpath Optional path to append
 * @returns Full mock Ollama server URL
 */
export function getMockOllamaUrl(subpath: string = ""): string {
  const formattedPath = subpath ? (subpath.startsWith("/") ? subpath : `/${subpath}`) : "";
  return `http://localhost:${config.mockServers.ollamaPort}${formattedPath}`;
}

/**
 * Check if proxy is running and responding
 * @returns true if proxy responds successfully, false if connection refused
 */
export async function isProxyRunning(): Promise<boolean> {
  try {
    const axios = (await import("axios")).default;
    await axios.get(getProxyUrl());
    return true;
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException | undefined;
    if (err && err.code === "ECONNREFUSED") {
      return false;
    }
    return true;
  }
}