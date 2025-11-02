import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";

import { createLogger } from "./logging/configLogger.js";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

interface ToolBridgeConfig {
  server: {
    defaultHost: string;
    defaultPort: string;
    servingMode: "openai" | "ollama";
    defaultDebugMode: boolean;
  };
  backends: {
    defaultMode: string;
    defaultChatPath: string;
    defaultBaseUrls?: {
      openai?: string;
      ollama?: string;
    };
    ollama: {
      defaultContextLength: number;
      defaultUrl: string;
    };
  };
  tools: {
    passTools: boolean;
    enableReinjection: boolean;
    reinjectionMessageCount: number;
    reinjectionTokenCount: number;
    reinjectionType: "system" | "user";
    maxIterations: number;
  };
  performance: {
    maxBufferSize: number;
    connectionTimeout: number;
    maxStreamBufferSize: number;
    streamConnectionTimeout: number;
  };
  headers: {
    httpReferer: string;
    xTitle: string;
  };

  validation: {
    placeholders: {
      baseUrl: string;
      apiKey: string;
      ollamaUrl: string;
    };
  };
  testing?: {
    models?: {
      openai?: string;
      ollama?: string;
    };
  };
}

const DEFAULT_CONFIG: ToolBridgeConfig = {
  server: {
    defaultHost: "0.0.0.0",
    defaultPort: "3000",
    servingMode: "openai",
    defaultDebugMode: false,
  },
  backends: {
    defaultMode: "openai",
    defaultChatPath: "/chat/completions",
    defaultBaseUrls: {
      openai: "https://api.openai.com/v1",
      ollama: "http://localhost:11434",
    },
    ollama: {
      defaultContextLength: 32768,
      defaultUrl: "http://localhost:11434",
    },
  },
  tools: {
    passTools: true,
    enableReinjection: true,
    reinjectionMessageCount: 3,
    reinjectionTokenCount: 1000,
    reinjectionType: "system",
    maxIterations: 5,
  },
  performance: {
    maxBufferSize: 1024 * 1024,
    connectionTimeout: 120_000,
    maxStreamBufferSize: 1024 * 1024,
    streamConnectionTimeout: 120_000,
  },
  headers: {
    httpReferer: "https://github.com/Oct4Pie/toolbridge",
    xTitle: "toolbridge",
  },
 
  validation: {
    placeholders: {
      baseUrl: "YOUR_BACKEND_LLM_BASE_URL_HERE",
      apiKey: "YOUR_BACKEND_LLM_API_KEY_HERE",
      ollamaUrl: "YOUR_OLLAMA_BASE_URL_HERE",
    },
  },
  testing: {
    models: {
      openai: "gpt-4o",
      ollama: "llama3.2:1b",
    },
  },
};

function getEnv(key: string): string | undefined {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}

function coalesceEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = getEnv(key);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

const envDebugFlag = getEnv("DEBUG_MODE");
const logger = createLogger(envDebugFlag?.toLowerCase() === "true");

function loadConfigFromFile(): DeepPartial<ToolBridgeConfig> {
  try {
    const configPath = join(process.cwd(), "config.json");
    const configFile = readFileSync(configPath, "utf8");
    return JSON.parse(configFile) as DeepPartial<ToolBridgeConfig>;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.warn(
      `[CONFIG] Unable to load config.json (${message}). Falling back to environment variables and defaults.`,
    );
    return {};
  }
}

const fileConfig = loadConfigFromFile();

const fileBaseUrls = fileConfig.backends?.defaultBaseUrls;
const defaultBaseUrlsConfig = DEFAULT_CONFIG.backends.defaultBaseUrls;
const resolvedBaseUrls: ToolBridgeConfig["backends"]["defaultBaseUrls"] = {};
const resolvedTestingModels: NonNullable<NonNullable<ToolBridgeConfig["testing"]>["models"]> = {};

if (fileBaseUrls?.openai !== undefined) {
  resolvedBaseUrls.openai = fileBaseUrls.openai;
} else if (defaultBaseUrlsConfig?.openai !== undefined) {
  resolvedBaseUrls.openai = defaultBaseUrlsConfig.openai;
}

if (fileBaseUrls?.ollama !== undefined) {
  resolvedBaseUrls.ollama = fileBaseUrls.ollama;
} else if (defaultBaseUrlsConfig?.ollama !== undefined) {
  resolvedBaseUrls.ollama = defaultBaseUrlsConfig.ollama;
}

const fileTestingModels = fileConfig.testing?.models;
const defaultTestingModels = DEFAULT_CONFIG.testing?.models;

if (fileTestingModels?.openai !== undefined) {
  resolvedTestingModels.openai = fileTestingModels.openai;
} else if (defaultTestingModels?.openai !== undefined) {
  resolvedTestingModels.openai = defaultTestingModels.openai;
}

if (fileTestingModels?.ollama !== undefined) {
  resolvedTestingModels.ollama = fileTestingModels.ollama;
} else if (defaultTestingModels?.ollama !== undefined) {
  resolvedTestingModels.ollama = defaultTestingModels.ollama;
}

const config: ToolBridgeConfig = {
  backends: {
    defaultMode: fileConfig.backends?.defaultMode ?? DEFAULT_CONFIG.backends.defaultMode,
    defaultChatPath:
      fileConfig.backends?.defaultChatPath ?? DEFAULT_CONFIG.backends.defaultChatPath,
    defaultBaseUrls: resolvedBaseUrls,
    ollama: {
      defaultContextLength:
        fileConfig.backends?.ollama?.defaultContextLength
        ?? DEFAULT_CONFIG.backends.ollama.defaultContextLength,
      defaultUrl:
        fileConfig.backends?.ollama?.defaultUrl ?? DEFAULT_CONFIG.backends.ollama.defaultUrl,
    },
  },
  server: {
    defaultHost: fileConfig.server?.defaultHost ?? DEFAULT_CONFIG.server.defaultHost,
    defaultPort: fileConfig.server?.defaultPort ?? DEFAULT_CONFIG.server.defaultPort,
    servingMode: (fileConfig.server?.servingMode ?? DEFAULT_CONFIG.server.servingMode) as "openai" | "ollama",
    defaultDebugMode: fileConfig.server?.defaultDebugMode ?? DEFAULT_CONFIG.server.defaultDebugMode,
  },
  tools: {
    passTools: fileConfig.tools?.passTools ?? DEFAULT_CONFIG.tools.passTools,
    enableReinjection: fileConfig.tools?.enableReinjection ?? DEFAULT_CONFIG.tools.enableReinjection,
    reinjectionMessageCount:
      fileConfig.tools?.reinjectionMessageCount ?? DEFAULT_CONFIG.tools.reinjectionMessageCount,
    reinjectionTokenCount:
      fileConfig.tools?.reinjectionTokenCount ?? DEFAULT_CONFIG.tools.reinjectionTokenCount,
    reinjectionType: fileConfig.tools?.reinjectionType ?? DEFAULT_CONFIG.tools.reinjectionType,
    maxIterations: fileConfig.tools?.maxIterations ?? DEFAULT_CONFIG.tools.maxIterations,
  },
  performance: {
    maxBufferSize: fileConfig.performance?.maxBufferSize ?? DEFAULT_CONFIG.performance.maxBufferSize,
    connectionTimeout:
      fileConfig.performance?.connectionTimeout ?? DEFAULT_CONFIG.performance.connectionTimeout,
    maxStreamBufferSize:
      fileConfig.performance?.maxStreamBufferSize ?? DEFAULT_CONFIG.performance.maxStreamBufferSize,
    streamConnectionTimeout:
      fileConfig.performance?.streamConnectionTimeout
      ?? DEFAULT_CONFIG.performance.streamConnectionTimeout,
  },
  headers: {
    httpReferer: fileConfig.headers?.httpReferer ?? DEFAULT_CONFIG.headers.httpReferer,
    xTitle: fileConfig.headers?.xTitle ?? DEFAULT_CONFIG.headers.xTitle,
  },
 
  validation: {
    placeholders: {
      baseUrl:
        fileConfig.validation?.placeholders?.baseUrl
        ?? DEFAULT_CONFIG.validation.placeholders.baseUrl,
      apiKey:
        fileConfig.validation?.placeholders?.apiKey
        ?? DEFAULT_CONFIG.validation.placeholders.apiKey,
      ollamaUrl:
        fileConfig.validation?.placeholders?.ollamaUrl
        ?? DEFAULT_CONFIG.validation.placeholders.ollamaUrl,
    },
  },
  ...(Object.keys(resolvedTestingModels).length > 0
    ? { testing: { models: resolvedTestingModels } }
    : {}),
};

export const PLACEHOLDER_API_KEY = config.validation.placeholders.apiKey;
export const PLACEHOLDER_OLLAMA_URL = config.validation.placeholders.ollamaUrl;

// ============================================================================
// CONFIGURATION (from config.json - SSOT for all non-sensitive settings)
// ============================================================================

// Backend mode - ONLY from config.json
export const BACKEND_MODE = config.backends.defaultMode.toLowerCase();
export const IS_OLLAMA_MODE = BACKEND_MODE === "ollama";

// Backend URL - from config.json based on backend mode
const defaultBackendUrls = config.backends.defaultBaseUrls;
export const BACKEND_LLM_BASE_URL = IS_OLLAMA_MODE
  ? (defaultBackendUrls?.ollama ?? config.backends.ollama.defaultUrl)
  : (defaultBackendUrls?.openai ?? "");

// Chat path - from config.json
const BACKEND_LLM_CHAT_PATH = config.backends.defaultChatPath;

// Ollama settings - from config.json
export const OLLAMA_BASE_URL = config.backends.ollama.defaultUrl;
export const OLLAMA_DEFAULT_CONTEXT_LENGTH = config.backends.ollama.defaultContextLength;

// Server configuration - from config.json
export const SERVING_MODE = config.server.servingMode as "openai" | "ollama";
export const PROXY_PORT = Number(config.server.defaultPort);
export const PROXY_HOST = config.server.defaultHost;

// Debug mode - from config.json
export const DEBUG_MODE = config.server.defaultDebugMode;

// ============================================================================
// SECRETS (from .env - SSOT for all sensitive data)
// ============================================================================

// API Keys (sensitive - from env only)
const ENV_BACKEND_LLM_API_KEY = coalesceEnv(
  "BACKEND_LLM_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
) ?? "";
const OLLAMA_API_KEY = getEnv("OLLAMA_API_KEY") ?? "";
export const BACKEND_LLM_API_KEY = IS_OLLAMA_MODE ? OLLAMA_API_KEY : ENV_BACKEND_LLM_API_KEY;

// ============================================================================
// TOOL CONFIGURATION (from config.json)
// ============================================================================

export const MAX_TOOL_ITERATIONS = config.tools.maxIterations;
export const PASS_TOOLS = config.tools.passTools;
export const ENABLE_TOOL_REINJECTION = config.tools.enableReinjection;
export const TOOL_REINJECTION_MESSAGE_COUNT = config.tools.reinjectionMessageCount;
export const TOOL_REINJECTION_TOKEN_COUNT = config.tools.reinjectionTokenCount;
export const TOOL_REINJECTION_TYPE: "system" | "user" = config.tools.reinjectionType;

// ============================================================================
// PERFORMANCE CONFIGURATION (from config.json)
// ============================================================================

export const MAX_BUFFER_SIZE = config.performance.maxBufferSize;
export const CONNECTION_TIMEOUT = config.performance.connectionTimeout;
export const MAX_STREAM_BUFFER_SIZE = config.performance.maxStreamBufferSize;
export const STREAM_CONNECTION_TIMEOUT = config.performance.streamConnectionTimeout;

// ============================================================================
// HEADERS (from config.json)
// ============================================================================

export const HTTP_REFERER = config.headers.httpReferer;
export const X_TITLE = config.headers.xTitle;

export const OPENAI_API_KEY = getEnv("OPENAI_API_KEY") ?? "";

// ============================================================================
// TEST MODELS (from config.json)
// ============================================================================

export const TEST_MODEL = config.testing?.models?.openai ?? "gpt-4o";
export const TEST_MODEL_OPENAI = config.testing?.models?.openai ?? "gpt-4o";
export const TEST_MODEL_OLLAMA = config.testing?.models?.ollama ?? "qwen3:latest";

// ============================================================================
// COMPUTED VALUES
// ============================================================================

const sanitizedBackendBaseUrl = BACKEND_LLM_BASE_URL.replace(/\/+$/, "");
const normalizedChatPath = BACKEND_LLM_CHAT_PATH.startsWith("/")
  ? BACKEND_LLM_CHAT_PATH
  : `/${BACKEND_LLM_CHAT_PATH}`;
export const CHAT_COMPLETIONS_FULL_URL =
  sanitizedBackendBaseUrl === "" ? "" : `${sanitizedBackendBaseUrl}${normalizedChatPath}`;

export function validateConfig(): void {
  const errors: string[] = [];

  // Validate SERVING_MODE
  const validServingModes = ["openai", "ollama"];
  if (!validServingModes.includes(SERVING_MODE)) {
    errors.push(`SERVING_MODE must be one of: ${validServingModes.join(", ")}. Got: ${SERVING_MODE}`);
  }

  // Validate BACKEND_MODE
  const validBackendModes = ["openai", "ollama"];
  if (!validBackendModes.includes(BACKEND_MODE)) {
    errors.push(`BACKEND_MODE must be one of: ${validBackendModes.join(", ")}. Got: ${BACKEND_MODE}`);
  }

  // Validate BACKEND_LLM_BASE_URL (can come from env or config.json)
  if (BACKEND_LLM_BASE_URL === "") {
    errors.push("BACKEND_LLM_BASE_URL is required. Set it in .env or configure default in config.json");
  }

  // Validate API keys (only from env - sensitive)
  if (!IS_OLLAMA_MODE) {
    if (BACKEND_LLM_API_KEY === "" || BACKEND_LLM_API_KEY === PLACEHOLDER_API_KEY) {
      errors.push("BACKEND_LLM_API_KEY is required for OpenAI-compatible backends (set in .env)");
    }
  }

  if (Number.isNaN(PROXY_PORT) || PROXY_PORT < 1 || PROXY_PORT > 65_535) {
    errors.push("PROXY_PORT must be a valid port number between 1 and 65535");
  }

  if (errors.length > 0) {
    const errorMessage = `Configuration validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`;
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  // Log configuration for debugging
  logger.info("ToolBridge Configuration:");
  logger.info(`  Serving Mode: ${SERVING_MODE} (clients use ${SERVING_MODE.toUpperCase()} API format)`);
  logger.info(`  Backend Mode: ${BACKEND_MODE} (connecting to ${BACKEND_MODE.toUpperCase()} provider)`);
  logger.info(`  Backend URL: ${BACKEND_LLM_BASE_URL}`);
  logger.info(`  Proxy: ${PROXY_HOST}:${PROXY_PORT}`);
  logger.info(`  Tool Configuration: Pass Tools=${PASS_TOOLS}, Reinjection=${ENABLE_TOOL_REINJECTION}`);
}
