import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";

import { createLogger } from "./utils/configLogger.js";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

interface ToolBridgeConfig {
  backends: {
    defaultMode: string;
    defaultChatPath: string;
    ollama: {
      defaultContextLength: number;
      defaultUrl: string;
    };
  };
  server: {
    defaultHost: string;
    defaultPort: number;
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
  azure: {
    defaultApiVersion: string;
  };
  validation: {
    placeholders: {
      baseUrl: string;
      apiKey: string;
      ollamaUrl: string;
    };
  };
}

const DEFAULT_CONFIG: ToolBridgeConfig = {
  backends: {
    defaultMode: "openai",
    defaultChatPath: "/chat/completions",
    ollama: {
      defaultContextLength: 32768,
      defaultUrl: "http://localhost:11434",
    },
  },
  server: {
    defaultHost: "0.0.0.0",
    defaultPort: 3000,
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
  azure: {
    defaultApiVersion: "2024-10-21",
  },
  validation: {
    placeholders: {
      baseUrl: "YOUR_BACKEND_LLM_BASE_URL_HERE",
      apiKey: "YOUR_BACKEND_LLM_API_KEY_HERE",
      ollamaUrl: "YOUR_OLLAMA_BASE_URL_HERE",
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

const config: ToolBridgeConfig = {
  backends: {
    defaultMode: fileConfig.backends?.defaultMode ?? DEFAULT_CONFIG.backends.defaultMode,
    defaultChatPath:
      fileConfig.backends?.defaultChatPath ?? DEFAULT_CONFIG.backends.defaultChatPath,
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
  azure: {
    defaultApiVersion:
      fileConfig.azure?.defaultApiVersion ?? DEFAULT_CONFIG.azure.defaultApiVersion,
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
};

const PLACEHOLDER_BASE_URL = config.validation.placeholders.baseUrl;
export const PLACEHOLDER_OLLAMA_URL = config.validation.placeholders.ollamaUrl;

const BACKEND_MODE = (getEnv("BACKEND_MODE") ?? config.backends.defaultMode).toLowerCase();
export const IS_OLLAMA_MODE = BACKEND_MODE === "ollama";

const fallbackOllamaBaseUrl = config.backends.ollama.defaultUrl;
const envOllamaBaseUrl = getEnv("OLLAMA_BASE_URL");
export const OLLAMA_BASE_URL = IS_OLLAMA_MODE
  ? envOllamaBaseUrl ?? fallbackOllamaBaseUrl
  : envOllamaBaseUrl ?? "";
const OLLAMA_API_KEY = getEnv("OLLAMA_API_KEY") ?? "";

const ENV_BACKEND_LLM_BASE_URL = coalesceEnv(
  "BACKEND_LLM_BASE_URL",
  "OPENAI_BASE_URL",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_API_BASE_URL",
) ?? "";
export const BACKEND_LLM_BASE_URL = IS_OLLAMA_MODE ? OLLAMA_BASE_URL : ENV_BACKEND_LLM_BASE_URL;

const BACKEND_LLM_CHAT_PATH =
  getEnv("BACKEND_LLM_CHAT_PATH") ?? config.backends.defaultChatPath;

const ENV_BACKEND_LLM_API_KEY = coalesceEnv(
  "BACKEND_LLM_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
) ?? "";
export const BACKEND_LLM_API_KEY = IS_OLLAMA_MODE ? OLLAMA_API_KEY : ENV_BACKEND_LLM_API_KEY;

export const OLLAMA_DEFAULT_CONTEXT_LENGTH = Number(
  getEnv("OLLAMA_DEFAULT_CONTEXT_LENGTH") ?? config.backends.ollama.defaultContextLength,
);

export const PROXY_PORT = Number(getEnv("PROXY_PORT") ?? config.server.defaultPort);
export const PROXY_HOST = getEnv("PROXY_HOST") ?? config.server.defaultHost;

export const MAX_TOOL_ITERATIONS = Number(
  getEnv("MAX_TOOL_ITERATIONS") ?? config.tools.maxIterations,
);
export const MAX_BUFFER_SIZE = Number(
  getEnv("MAX_BUFFER_SIZE") ?? config.performance.maxBufferSize,
);
export const CONNECTION_TIMEOUT = Number(
  getEnv("CONNECTION_TIMEOUT") ?? config.performance.connectionTimeout,
);

const envPassTools = getEnv("PASS_TOOLS");
export const PASS_TOOLS =
  envPassTools !== undefined ? envPassTools !== "false" : config.tools.passTools;

const envEnableToolReinjection = getEnv("ENABLE_TOOL_REINJECTION");
export const ENABLE_TOOL_REINJECTION =
  envEnableToolReinjection !== undefined
    ? envEnableToolReinjection !== "false"
    : config.tools.enableReinjection;

export const TOOL_REINJECTION_MESSAGE_COUNT = Number(
  getEnv("TOOL_REINJECTION_MESSAGE_COUNT") ?? config.tools.reinjectionMessageCount,
);
export const TOOL_REINJECTION_TOKEN_COUNT = Number(
  getEnv("TOOL_REINJECTION_TOKEN_COUNT") ?? config.tools.reinjectionTokenCount,
);
export const TOOL_REINJECTION_TYPE: "system" | "user" =
  getEnv("TOOL_REINJECTION_TYPE") === "user"
    ? "user"
    : config.tools.reinjectionType === "user"
      ? "user"
      : "system";

export const HTTP_REFERER = config.headers.httpReferer;
export const X_TITLE = config.headers.xTitle;

export const PLACEHOLDER_API_KEY = config.validation.placeholders.apiKey;

export const DEBUG_MODE = envDebugFlag?.toLowerCase() === "true";

export const MAX_STREAM_BUFFER_SIZE = Number(
  getEnv("MAX_STREAM_BUFFER_SIZE") ?? config.performance.maxStreamBufferSize,
);
export const STREAM_CONNECTION_TIMEOUT = Number(
  getEnv("STREAM_CONNECTION_TIMEOUT") ?? config.performance.streamConnectionTimeout,
);

export const AZURE_OPENAI_API_KEY = getEnv("AZURE_OPENAI_API_KEY");
export const AZURE_OPENAI_RESOURCE = getEnv("AZURE_OPENAI_RESOURCE");
export const AZURE_API_VERSION =
  getEnv("AZURE_API_VERSION") ?? config.azure.defaultApiVersion;

export const AZURE_TENANT_ID = getEnv("AZURE_TENANT_ID");
export const AZURE_CLIENT_ID = getEnv("AZURE_CLIENT_ID");
export const AZURE_CLIENT_SECRET = getEnv("AZURE_CLIENT_SECRET");
export const AZURE_SUBSCRIPTION_ID = getEnv("AZURE_SUBSCRIPTION_ID");
export const AZURE_RESOURCE_GROUP = getEnv("AZURE_RESOURCE_GROUP");
export const AZURE_ACCOUNT_NAME = getEnv("AZURE_ACCOUNT_NAME");

export const AZURE_BASE_V1 = AZURE_OPENAI_RESOURCE
  ? `https://${AZURE_OPENAI_RESOURCE}.openai.azure.com/openai/v1`
  : undefined;
export const AZURE_BASE_CLASSIC = AZURE_OPENAI_RESOURCE
  ? `https://${AZURE_OPENAI_RESOURCE}.openai.azure.com/openai`
  : undefined;

export const OPENAI_API_KEY = getEnv("OPENAI_API_KEY") ?? "";

const sanitizedBackendBaseUrl = BACKEND_LLM_BASE_URL.replace(/\/+$/, "");
const normalizedChatPath = BACKEND_LLM_CHAT_PATH.startsWith("/")
  ? BACKEND_LLM_CHAT_PATH
  : `/${BACKEND_LLM_CHAT_PATH}`;
export const CHAT_COMPLETIONS_FULL_URL =
  sanitizedBackendBaseUrl === "" ? "" : `${sanitizedBackendBaseUrl}${normalizedChatPath}`;

export function validateConfig(): void {
  const errors: string[] = [];

  if (BACKEND_LLM_BASE_URL === "" || BACKEND_LLM_BASE_URL === PLACEHOLDER_BASE_URL) {
    errors.push("BACKEND_LLM_BASE_URL is required and must not be the placeholder value");
  }

  if (!IS_OLLAMA_MODE) {
    if (BACKEND_LLM_API_KEY === "" || BACKEND_LLM_API_KEY === PLACEHOLDER_API_KEY) {
      errors.push("BACKEND_LLM_API_KEY is required for OpenAI-compatible backends");
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

  logger.info("Configuration loaded and validated successfully.");
  logger.info(`Backend Mode: ${BACKEND_MODE.toUpperCase()}`);
  logger.info(
    `Backend URL: ${BACKEND_LLM_BASE_URL} (used for both OpenAI and Ollama formats)`,
  );
  logger.info(
    `Ollama Default Context Length (for synthetic /api/show): ${OLLAMA_DEFAULT_CONTEXT_LENGTH}`,
  );
  logger.info(
    `Tool Configuration: Pass Tools=${PASS_TOOLS}, Reinjection=${ENABLE_TOOL_REINJECTION}, Max Iterations=${MAX_TOOL_ITERATIONS}`,
  );
}
