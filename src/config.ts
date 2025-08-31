import "dotenv/config";
import { createLogger } from "./utils/configLogger.js";

const PLACEHOLDER_BASE_URL = "YOUR_BACKEND_LLM_BASE_URL_HERE";

export const PLACEHOLDER_OLLAMA_URL = "YOUR_OLLAMA_BASE_URL_HERE";

// Cast env values to string | undefined before applying nullish coalescing
const BACKEND_MODE = (((process.env.BACKEND_MODE) ?? "openai")).toLowerCase();
export const IS_OLLAMA_MODE = BACKEND_MODE === "ollama";

// Prefer explicit OLLAMA_BASE_URL but default to local daemon when in Ollama mode
export const OLLAMA_BASE_URL = IS_OLLAMA_MODE
  ? ((process.env.OLLAMA_BASE_URL) ?? "http://localhost:11434")
  : ((process.env.OLLAMA_BASE_URL) ?? "");
const OLLAMA_API_KEY = (process.env.OLLAMA_API_KEY) ?? "";

// Accept common env aliases for real providers (OpenAI/OpenRouter)
const ENV_BACKEND_LLM_BASE_URL =
  ((process.env.BACKEND_LLM_BASE_URL as string | undefined)
  || (process.env.OPENAI_BASE_URL as string | undefined)
  || (process.env.OPENROUTER_BASE_URL as string | undefined)
  || (process.env.OPENROUTER_API_BASE_URL as string | undefined)
  || "");
export const BACKEND_LLM_BASE_URL: string = IS_OLLAMA_MODE
  ? OLLAMA_BASE_URL
  : ENV_BACKEND_LLM_BASE_URL;

const BACKEND_LLM_CHAT_PATH = (process.env.BACKEND_LLM_CHAT_PATH) ?? "/chat/completions";

// Accept common API key envs while keeping BACKEND_LLM_API_KEY as canonical
const ENV_BACKEND_LLM_API_KEY =
  (process.env.BACKEND_LLM_API_KEY)
  || (process.env.OPENAI_API_KEY)
  || (process.env.OPENROUTER_API_KEY)
  || "";
export const BACKEND_LLM_API_KEY: string = IS_OLLAMA_MODE
  ? OLLAMA_API_KEY
  : ENV_BACKEND_LLM_API_KEY;

export const OLLAMA_DEFAULT_CONTEXT_LENGTH: number = parseInt(
  (process.env.OLLAMA_DEFAULT_CONTEXT_LENGTH as string | undefined) ?? "32768",
  10,
);

export const PROXY_PORT: number = Number((process.env.PROXY_PORT as string | undefined) ?? "3000");
export const PROXY_HOST: string = (process.env.PROXY_HOST as string | undefined) ?? "0.0.0.0";

export const MAX_TOOL_ITERATIONS = 5;
export const MAX_BUFFER_SIZE = Number((process.env.MAX_BUFFER_SIZE) ?? String(1024 * 1024));
export const CONNECTION_TIMEOUT = Number((process.env.CONNECTION_TIMEOUT) ?? "120000");
// === Required OpenRouter Headers (hardcoded, non-configurable) ===
// Must be exactly these values for all requests, including tests.
export const HTTP_REFERER = "https://github.com/Oct4Pie/toolbridge";
export const X_TITLE = "toolbridge";

export const PLACEHOLDER_API_KEY = "YOUR_BACKEND_LLM_API_KEY_HERE";

export const DEBUG_MODE: boolean = (((process.env.DEBUG_MODE as string | undefined) ?? "") === "true");
export const ENABLE_TOOL_REINJECTION: boolean = (((process.env.ENABLE_TOOL_REINJECTION as string | undefined) ?? "true") !== "false");
export const TOOL_REINJECTION_MESSAGE_COUNT: number = Number((process.env.TOOL_REINJECTION_MESSAGE_COUNT as string | undefined) ?? "3");
export const TOOL_REINJECTION_TOKEN_COUNT: number = Number((process.env.TOOL_REINJECTION_TOKEN_COUNT as string | undefined) ?? "1000");
export const TOOL_REINJECTION_TYPE: 'system' | 'user' = (process.env.TOOL_REINJECTION_TYPE === 'user') ? 'user' : 'system';

export const MAX_STREAM_BUFFER_SIZE: number = Number((process.env.MAX_STREAM_BUFFER_SIZE as string | undefined) ?? "1048576");
export const STREAM_CONNECTION_TIMEOUT: number = Number((process.env.STREAM_CONNECTION_TIMEOUT as string | undefined) ?? "120000");

// Derived URLs
export const CHAT_COMPLETIONS_FULL_URL: string =
  BACKEND_LLM_BASE_URL !== ""
    ? `${BACKEND_LLM_BASE_URL.replace(/\/+$/, '')}${BACKEND_LLM_CHAT_PATH}`
    : "";

const logger = createLogger("CONFIG");

export function validateConfig(): void {
  const errors: string[] = [];

  // Validate backend URL
  if (BACKEND_LLM_BASE_URL === "" || BACKEND_LLM_BASE_URL === PLACEHOLDER_BASE_URL) {
    errors.push("BACKEND_LLM_BASE_URL is required and must not be the placeholder value");
  }

  // Validate API key for non-Ollama backends
  if (!IS_OLLAMA_MODE) {
    if (BACKEND_LLM_API_KEY === "" || BACKEND_LLM_API_KEY === PLACEHOLDER_API_KEY) {
      errors.push("BACKEND_LLM_API_KEY is required for OpenAI-compatible backends");
    }
  }

  // Validate port
  if (isNaN(PROXY_PORT) || PROXY_PORT < 1 || PROXY_PORT > 65535) {
    errors.push("PROXY_PORT must be a valid port number between 1 and 65535");
  }

  // OpenRouter headers are now hardcoded and always present

  // Throw errors if any
  if (errors.length > 0) {
    const errorMessage = "Configuration validation failed:\n" + errors.map(e => `- ${e}`).join('\n');
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  logger.info("Configuration loaded and validated successfully.");
  logger.info(`Backend Mode: ${BACKEND_MODE.toUpperCase()}`);
  logger.info(`Backend URL: ${BACKEND_LLM_BASE_URL} (used for both OpenAI and Ollama formats)`);
  logger.info(`Ollama Default Context Length (for synthetic /api/show): ${OLLAMA_DEFAULT_CONTEXT_LENGTH}`);
}