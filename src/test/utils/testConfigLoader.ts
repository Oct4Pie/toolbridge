/**
 * Test Configuration Loader - Single Source of Truth (SSOT)
 *
 * This module provides centralized, immutable test configuration loaded from:
 * 1. Environment variables (highest priority)
 * 2. config.json (medium priority)
 * 3. Hardcoded defaults (lowest priority)
 *
 * Implements singleton pattern to ensure configuration is loaded exactly once
 * at application startup, providing a consistent, frozen configuration object
 * for all test modules.
 *
 * Usage:
 *   import { testConfigLoader } from './testConfigLoader.js';
 *   const config = testConfigLoader.getConfig();
 *   const proxyPort = config.server.proxyPort;
 */

import { readFileSync } from "fs";
import { join } from "path";

/**
 * Complete testing configuration interface
 * Mirrors the structure defined in config.json under the "testing" section
 */
export interface TestingConfig {
  /** Server configuration for proxy and port management */
  server: {
    /** Port number for the proxy server */
    proxyPort: number;
    /** Host address for the proxy server */
    proxyHost: string;
    /** Start of port range for dynamic port allocation */
    portRangeStart: number;
    /** End of port range for dynamic port allocation */
    portRangeEnd: number;
  };

  /** Mock server configuration for testing backends */
  mockServers: {
    /** Port for mock OpenAI-compatible server */
    openaiPort: number;
    /** Port for mock Ollama server */
    ollamaPort: number;
    /** Default response delay in milliseconds for mock servers */
    defaultResponseDelay: number;
  };

  /** LLM model configuration for testing */
  models: {
    /** Primary OpenAI-compatible model for tests */
    openaiCompatible: string;
    /** Primary Ollama model for tests */
    ollama: string;
    /** Fallback models when primary models are unavailable */
    fallbacks: {
      /** Fallback OpenAI-compatible model */
      openaiCompatible: string;
      /** Fallback Ollama model */
      ollama: string;
    };
  };

  /** Backend service URLs for testing */
  backends: {
    /** Base URL for OpenAI-compatible API endpoint */
    openaiCompatibleUrl: string;
    /** Base URL for Ollama API endpoint */
    ollamaUrl: string;
  };

  /** Timeout configuration for various test operations */
  timeouts: {
    /** Standard timeout for most test operations (ms) */
    standard: number;
    /** Timeout for establishing connections (ms) */
    connection: number;
    /** Socket-level timeout (ms) */
    socket: number;
    /** Timeout for waiting on port availability (ms) */
    portWait: number;
  };

  /** Feature flags for test behavior control */
  features: {
    /** Enable streaming protocol testing */
    enableStreamTesting: boolean;
    /** Enable tool calling functionality tests */
    enableToolCalling: boolean;
    /** Enable dual client (OpenAI SDK + Ollama client) testing */
    enableDualClient: boolean;
    /** Maximum number of concurrent tests to run */
    concurrentTestLimit: number;
  };
}

/**
 * Hardcoded default configuration
 * Used when values are not found in config.json or environment variables
 */
const DEFAULT_CONFIG: TestingConfig = {
  server: {
    proxyPort: 3100,
    proxyHost: "localhost",
    portRangeStart: 3100,
    portRangeEnd: 3100,
  },
  mockServers: {
    openaiPort: 3001,
    ollamaPort: 3002,
    defaultResponseDelay: 100,
  },
  models: {
    openaiCompatible: "deepseek/deepseek-chat-v3.1:free",
    ollama: "llama3.2:1b",
    fallbacks: {
      openaiCompatible: "gpt-4o",
      ollama: "qwen3:latest",
    },
  },
  backends: {
    // Environment variables: OPENAI_BACKEND_URL overrides default
    openaiCompatibleUrl: process.env["OPENAI_BACKEND_URL"] ?? "https://api.openai.com/v1",
    // Environment variables: OLLAMA_BACKEND_URL or OLLAMA_HOST overrides default
    ollamaUrl: process.env["OLLAMA_BACKEND_URL"] ?? process.env["OLLAMA_HOST"] ?? "http://localhost:11434",
  },
  timeouts: {
    standard: 30000,
    connection: 120000,
    socket: 1000,
    portWait: 30000,
  },
  features: {
    enableStreamTesting: true,
    enableToolCalling: true,
    enableDualClient: true,
    concurrentTestLimit: 5,
  },
};

/**
 * Internal configuration structure from config.json
 * Partial interface to allow missing properties in JSON
 */
interface ConfigJsonStructure {
  testing?: Partial<TestingConfig>;
}

/**
 * Singleton loader for test configuration
 * Ensures configuration is loaded exactly once and provides a frozen, immutable view
 */
class TestConfigLoader {
  /** Singleton instance */
  private static instance: TestConfigLoader;

  /** Cached configuration - loaded once at instantiation */
  private config: Readonly<TestingConfig>;

  /**
   * Private constructor ensures singleton pattern
   * Loads configuration from config.json + environment variables
   */
  private constructor() {
    this.config = Object.freeze(this.loadConfiguration());
  }

  /**
   * Get singleton instance
   * Lazily creates instance on first call, returns cached instance thereafter
   */
  static getInstance(): TestConfigLoader {
    if (!TestConfigLoader.instance) {
      TestConfigLoader.instance = new TestConfigLoader();
    }
    return TestConfigLoader.instance;
  }

  /**
   * Get complete, immutable test configuration
   * @returns Readonly TestingConfig object with all settings
   */
  getConfig(): Readonly<TestingConfig> {
    return this.config;
  }

  /**
   * Load configuration from multiple sources with priority order:
   * 1. Environment variables (highest priority)
   * 2. config.json values
   * 3. Hardcoded defaults (lowest priority)
   *
   * @returns Complete TestingConfig with all values resolved
   * @throws Error if configuration values cannot be parsed/validated
   */
  private loadConfiguration(): TestingConfig {
    // Load config.json
    const fileConfig = this.loadConfigJson();

    // Merge with priority: env > file > defaults
    return {
      server: {
        proxyPort: this.getEnvNumber(
          "PROXY_PORT",
          fileConfig.server?.proxyPort ?? DEFAULT_CONFIG.server.proxyPort,
        ),
        proxyHost: this.getEnvString(
          "PROXY_HOST",
          fileConfig.server?.proxyHost ?? DEFAULT_CONFIG.server.proxyHost,
        ),
        portRangeStart: this.getEnvNumber(
          "PORT_RANGE_START",
          fileConfig.server?.portRangeStart ?? DEFAULT_CONFIG.server.portRangeStart,
        ),
        portRangeEnd: this.getEnvNumber(
          "PORT_RANGE_END",
          fileConfig.server?.portRangeEnd ?? DEFAULT_CONFIG.server.portRangeEnd,
        ),
      },
      mockServers: {
        openaiPort: this.getEnvNumber(
          "MOCK_OPENAI_PORT",
          fileConfig.mockServers?.openaiPort ?? DEFAULT_CONFIG.mockServers.openaiPort,
        ),
        ollamaPort: this.getEnvNumber(
          "MOCK_OLLAMA_PORT",
          fileConfig.mockServers?.ollamaPort ?? DEFAULT_CONFIG.mockServers.ollamaPort,
        ),
        defaultResponseDelay: this.getEnvNumber(
          "MOCK_DEFAULT_RESPONSE_DELAY",
          fileConfig.mockServers?.defaultResponseDelay ??
            DEFAULT_CONFIG.mockServers.defaultResponseDelay,
        ),
      },
      models: {
        openaiCompatible: this.getEnvString(
          "TEST_MODEL_OPENAI_COMPATIBLE",
          fileConfig.models?.openaiCompatible ?? DEFAULT_CONFIG.models.openaiCompatible,
        ),
        ollama: this.getEnvString(
          "TEST_MODEL_OLLAMA",
          fileConfig.models?.ollama ?? DEFAULT_CONFIG.models.ollama,
        ),
        fallbacks: {
          openaiCompatible: this.getEnvString(
            "TEST_MODEL_OPENAI_COMPATIBLE_FALLBACK",
            fileConfig.models?.fallbacks?.openaiCompatible ??
              DEFAULT_CONFIG.models.fallbacks.openaiCompatible,
          ),
          ollama: this.getEnvString(
            "TEST_MODEL_OLLAMA_FALLBACK",
            fileConfig.models?.fallbacks?.ollama ?? DEFAULT_CONFIG.models.fallbacks.ollama,
          ),
        },
      },
      backends: {
        openaiCompatibleUrl: this.getEnvString(
          "TEST_BACKEND_OPENAI_COMPATIBLE_URL",
          fileConfig.backends?.openaiCompatibleUrl ?? DEFAULT_CONFIG.backends.openaiCompatibleUrl,
        ),
        ollamaUrl: this.getEnvString(
          "TEST_BACKEND_OLLAMA_URL",
          fileConfig.backends?.ollamaUrl ?? DEFAULT_CONFIG.backends.ollamaUrl,
        ),
      },
      timeouts: {
        standard: this.getEnvNumber(
          "TEST_TIMEOUT_STANDARD",
          fileConfig.timeouts?.standard ?? DEFAULT_CONFIG.timeouts.standard,
        ),
        connection: this.getEnvNumber(
          "TEST_TIMEOUT_CONNECTION",
          fileConfig.timeouts?.connection ?? DEFAULT_CONFIG.timeouts.connection,
        ),
        socket: this.getEnvNumber(
          "TEST_TIMEOUT_SOCKET",
          fileConfig.timeouts?.socket ?? DEFAULT_CONFIG.timeouts.socket,
        ),
        portWait: this.getEnvNumber(
          "TEST_TIMEOUT_PORT_WAIT",
          fileConfig.timeouts?.portWait ?? DEFAULT_CONFIG.timeouts.portWait,
        ),
      },
      features: {
        enableStreamTesting: this.getEnvBoolean(
          "TEST_ENABLE_STREAM_TESTING",
          fileConfig.features?.enableStreamTesting ?? DEFAULT_CONFIG.features.enableStreamTesting,
        ),
        enableToolCalling: this.getEnvBoolean(
          "TEST_ENABLE_TOOL_CALLING",
          fileConfig.features?.enableToolCalling ?? DEFAULT_CONFIG.features.enableToolCalling,
        ),
        enableDualClient: this.getEnvBoolean(
          "TEST_ENABLE_DUAL_CLIENT",
          fileConfig.features?.enableDualClient ?? DEFAULT_CONFIG.features.enableDualClient,
        ),
        concurrentTestLimit: this.getEnvNumber(
          "TEST_CONCURRENT_LIMIT",
          fileConfig.features?.concurrentTestLimit ?? DEFAULT_CONFIG.features.concurrentTestLimit,
        ),
      },
    };
  }

  /**
   * Load configuration from config.json
   * Gracefully handles missing or invalid JSON
   *
   * @returns Partial TestingConfig from config.json or empty object if not found
   */
  private loadConfigJson(): Partial<TestingConfig> {
    try {
      // Resolve from workspace root
      const workspaceRoot = this.getWorkspaceRoot();
      const configPath = join(workspaceRoot, "config.json");

      const fileContent = readFileSync(configPath, "utf-8");
      const configFile = JSON.parse(fileContent) as ConfigJsonStructure;

      return configFile.testing ?? {};
    } catch {
      // Silently continue with defaults if config.json not found or invalid
      // This is expected in some environments
      return {};
    }
  }

  /**
   * Get workspace root directory
   * Traverses up from current directory to find package.json or uses cwd
   *
   * @returns Absolute path to workspace root
   */
  private getWorkspaceRoot(): string {
    // Start from current working directory
    return process.cwd();
  }

  /**
   * Get string value from environment or return default
   * @param key Environment variable name
   * @param defaultValue Fallback value if env var not set
   * @returns Environment value or default
   */
  private getEnvString(key: string, defaultValue: string): string {
    const value = process.env[key];
    return typeof value === "string" && value.length > 0 ? value : defaultValue;
  }

  /**
   * Get numeric value from environment or return default
   * Handles string-to-number conversion with validation
   *
   * @param key Environment variable name
   * @param defaultValue Fallback value if env var not set or invalid
   * @returns Parsed number or default
   */
  private getEnvNumber(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return defaultValue;
  }

  /**
   * Get boolean value from environment or return default
   * Recognizes "true", "1", "yes", "on" (case-insensitive) as true
   * All other values treated as false
   *
   * @param key Environment variable name
   * @param defaultValue Fallback value if env var not set
   * @returns Parsed boolean or default
   */
  private getEnvBoolean(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      return ["true", "1", "yes", "on"].includes(value.toLowerCase());
    }
    return defaultValue;
  }
}

/**
 * Singleton instance of TestConfigLoader
 * Provides lazy-loaded test configuration as frozen, immutable object
 *
 * Usage:
 *   import { testConfigLoader } from './testConfigLoader.js';
 *   const config = testConfigLoader.getConfig();
 */
export const testConfigLoader = TestConfigLoader.getInstance();

/**
 * Convenience export: Get test configuration directly
 * Equivalent to testConfigLoader.getConfig()
 */
export function getTestConfig(): Readonly<TestingConfig> {
  return testConfigLoader.getConfig();
}
