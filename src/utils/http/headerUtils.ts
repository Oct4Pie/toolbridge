import {
  BACKEND_LLM_API_KEY,
  HTTP_REFERER,
  PLACEHOLDER_API_KEY,
  X_TITLE,
} from "../../config.js";
import { FORMAT_OLLAMA, FORMAT_OPENAI } from "../../handlers/formatDetector.js";
import { logger } from "../../logging/index.js";

import type { RequestFormat } from "../../types/index.js";

interface BackendHeaders {
  "Content-Type": string;
  "Authorization"?: string;
  "HTTP-Referer": string; // mandatory
  "Referer": string; // mandatory
  "X-Title": string; // mandatory
  [key: string]: string | undefined;
}

interface ClientHeaders {
  [key: string]: string | string[] | undefined;
}

/**
 * Headers to preserve from client request, organized by provider.
 */
const PASSTHROUGH_HEADERS = {
  openai: [
    'openai-organization',
    'openai-project',
    'user-agent',
    'x-custom-header',
  ],
  ollama: [
    'user-agent',
    'x-custom-header',
  ],
};

export function buildBackendHeaders(
  clientAuthHeader?: string,
  clientHeaders?: ClientHeaders,
  _context: string = "unknown",
  clientFormat: RequestFormat = FORMAT_OPENAI,
  targetProvider: string = 'openai',
): BackendHeaders {
  const headers: BackendHeaders = {
    "Content-Type": "application/json",
    "HTTP-Referer": HTTP_REFERER,
    "Referer": HTTP_REFERER,
    "X-Title": X_TITLE,
  };

  const useOllamaAuth = clientFormat === FORMAT_OLLAMA;

  // Authentication handling
  // OpenAI and Ollama use Bearer token
  if (BACKEND_LLM_API_KEY && BACKEND_LLM_API_KEY !== PLACEHOLDER_API_KEY) {
    headers["Authorization"] = `Bearer ${BACKEND_LLM_API_KEY}`;
    logger.debug(
      `[AUTH] Using configured ${useOllamaAuth ? "OLLAMA_API_KEY" : "BACKEND_LLM_API_KEY"} for ${clientFormat} format client`,
    );
  } else if (useOllamaAuth) {
    logger.debug(
      `[AUTH] No API key configured. Assuming Ollama backend doesn't require auth.`,
    );
  } else if (clientAuthHeader) {
    headers["Authorization"] = clientAuthHeader;
    logger.debug(
      `[AUTH] Using client-provided Authorization header for OpenAI format client (no server key configured).`,
    );
  } else {
    logger.warn(
      `[AUTH] Warning: No client Authorization header and no BACKEND_LLM_API_KEY configured. Request will likely fail.`,
    );
  }

  // Passthrough provider-specific headers
  const passthroughList = PASSTHROUGH_HEADERS[targetProvider as keyof typeof PASSTHROUGH_HEADERS] || [];
  if (clientHeaders) {
    for (const headerName of passthroughList) {
      const clientValue = clientHeaders[headerName];
      if (clientValue !== undefined) {
        const headerValue = Array.isArray(clientValue) ? clientValue.join(',') : clientValue;
        headers[headerName] = headerValue;
        logger.debug(`[HEADERS] Passed through ${headerName} from client`);
      }
    }
  }

  return headers;
}