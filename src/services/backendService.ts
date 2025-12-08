/**
 * Backend Service Implementation
 * 
 * SSOT for all backend LLM communication.
 * Handles request dispatch, retries, error handling.
 */

import axios, { type AxiosError, type AxiosResponse } from "axios";

import { config } from "../config.js";
import { OLLAMA_ENDPOINTS, OPENAI_ENDPOINTS } from "../constants/endpoints.js";
import { FORMAT_OLLAMA } from "../handlers/formatDetector.js";
import { logger } from "../logging/index.js";
import { buildBackendHeaders, streamToString } from "../utils/http/index.js";

import { configService } from "./configService.js";

import type { BackendService } from "./contracts.js";
import type {
  BackendPayload,
  BackendError,
  RequestFormat,
  OpenAIResponse,
  OllamaResponse
} from "../types/index.js";
import type { Readable } from "stream";

interface BackendRequestHeaders {
  [key: string]: string | undefined;
}

class BackendServiceImpl implements BackendService {
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseRetryAfter(headerValue: string | undefined, maxMs = 3100): number | null {
    if (!headerValue) { return null; }
    const seconds = Number(headerValue);
    if (!Number.isNaN(seconds) && seconds >= 0) {
      return Math.min(Math.floor(seconds * 1000), maxMs);
    }
    return null;
  }

  private logRequest(
    payload: BackendPayload,
    headers: BackendRequestHeaders,
    format: RequestFormat,
    url: string,
    streamRequested: boolean
  ): void {
    logger.debug(
      `\n[BACKEND REQUEST] Sending request to ${format.toUpperCase()} backend (${url})`,
    );
    logger.debug(`[BACKEND REQUEST] Method: POST, Stream: ${streamRequested}`);

    const loggedHeaders: BackendRequestHeaders = { ...headers };
    if (loggedHeaders["Authorization"]) {
      loggedHeaders["Authorization"] = "Bearer ********";
    }
    if (loggedHeaders["HTTP-Referer"]) {
      loggedHeaders["Referer"] = loggedHeaders["HTTP-Referer"];
      delete loggedHeaders["HTTP-Referer"];
    }
    logger.debug(
      `[BACKEND REQUEST] Headers:`,
      JSON.stringify(loggedHeaders, null, 2),
    );

    logger.debug(`[BACKEND REQUEST] Payload:`, JSON.stringify(payload, null, 2));
  }

  private async postWithRetries<T>(
    url: string,
    payload: unknown,
    options: { headers: Record<string, string | undefined>; responseType: "json" | "stream" },
    maxRetries = 2,
    baseDelayMs = 500,
  ): Promise<AxiosResponse<T>> {
    let attempt = 0;
    // Use stream timeout for streaming requests, connection timeout otherwise
    const timeout = options.responseType === "stream" 
      ? config.performance.streamConnectionTimeout 
      : config.performance.connectionTimeout;
    
    for (;;) {
      try {
        return await axios.post<T>(url, payload, { ...options, timeout });
      } catch (err) {
        const error = err as AxiosError;
        const status = error.response?.status ?? 0;
        const headers = error.response?.headers;
        const retryAfterHeader = headers?.["retry-after"];
        const retryAfterMs = this.parseRetryAfter(
          typeof retryAfterHeader === 'string' ? retryAfterHeader : undefined, 
          3100
        );
        const retriable = (status >= 500 && status < 600) || !error.response || (status === 429 && retryAfterMs !== null);
        
        if (!retriable || attempt >= maxRetries) {
          throw error;
        }

        const backoff = retryAfterMs ?? Math.min(baseDelayMs * 2 ** attempt, 3100);
        logger.warn(`[BACKEND REQUEST] Retrying (${attempt + 1}/${maxRetries}) after ${backoff}ms due to ${status || "network error"}.`);
        await this.sleep(backoff);
        attempt++;
      }
    }
  }

  private async handleRequestError(
    error: AxiosError,
    clientFormat: RequestFormat,
    url: string,
  ): Promise<BackendError> {
    let errorMessage = `Backend ${clientFormat.toUpperCase()} request to ${url} failed.`;
    let errorStatus = 500;

    if (error.response) {
      errorStatus = error.response.status;
      const contentType = error.response.headers["content-type"];
      let errorBody = "[Could not read error body]";

      if (contentType?.includes("stream") && 
          error.response.data && 
          typeof error.response.data === 'object' && 
          'readable' in error.response.data) {
        try {
          errorBody = await streamToString(error.response.data as Readable);
          errorMessage += ` Status ${errorStatus}. Stream Error Body: ${errorBody}`;
        } catch (streamError: unknown) {
          const streamErrorMessage = streamError instanceof Error ? streamError.message : 'Unknown stream error';
          errorMessage += ` Status ${errorStatus}. Failed to read error stream: ${streamErrorMessage}`;
        }
      } else if (contentType?.includes("json")) {
        try {
          errorBody = JSON.stringify(error.response.data);
          errorMessage += ` Status ${errorStatus}. Error Body: ${errorBody}`;
        } catch {
          // If stringify fails, try to extract useful info from the object
          try {
            errorBody = JSON.stringify(error.response.data, null, 2);
          } catch {
            errorBody = String(error.response.data);
          }
          errorMessage += ` Status ${errorStatus}. Error Body: ${errorBody}`;
        }
      } else {
        errorBody = typeof error.response.data === "string"
          ? error.response.data
          : JSON.stringify(error.response.data, null, 2);
        errorMessage += ` Status ${errorStatus}. Error Body: ${errorBody}`;
      }
      
      logger.error(`[BACKEND ERROR] Response Status: ${errorStatus}`);
      logger.error(
        `[BACKEND ERROR] Response Headers:`,
        JSON.stringify(error.response.headers, null, 2),
      );
      logger.error(`[BACKEND ERROR] Response Body:`, errorBody);
    } else if (error.request) {
      errorMessage += ` No response received from server. This could indicate a network issue, timeout, or incorrect URL/port.`;
      errorStatus = 504;
      logger.error(
        `[BACKEND ERROR] No response received for request to ${url}. Error Code: ${error.code ?? "N/A"}`,
      );
    } else {
      errorMessage += ` Request setup failed: ${error.message}`;
      logger.error(
        `[BACKEND ERROR] Request setup failed for ${url}: ${error.message}`,
      );
    }

    logger.error(`[ERROR] ${errorMessage}`);

    const backendError = new Error(errorMessage) as BackendError;
    backendError.status = errorStatus;
    if (error.response) {
      backendError.response = error.response;
    }
    backendError.request = error.request;

    throw backendError;
  }

  async sendRequest(
    payload: unknown,
    stream: boolean,
    format: RequestFormat,
    provider: string,
    authHeader?: string,
    headers?: Record<string, string | string[] | undefined>
  ): Promise<unknown | Readable> {
    const backendHeaders: BackendRequestHeaders = buildBackendHeaders(
      authHeader,
      headers,
      "chat",
      format,
      provider,
    );

    const backendPayload = payload as BackendPayload;
    backendPayload.stream = stream;

    // Determine URL based on format (supports auto-detection)
    let apiUrl: string;
    let endpointPath = "";

    if (format === FORMAT_OLLAMA) {
      // Use Ollama backend URL
      const baseUrl = configService.getOllamaBackendUrl();
      apiUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
      endpointPath = OLLAMA_ENDPOINTS.CHAT;
    } else {
      // Use OpenAI backend URL
      let baseUrl = configService.getOpenAIBackendUrl();
      // Remove trailing slash
      baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

      // Check if URL already includes the chat completions endpoint
      if (baseUrl.endsWith("/chat/completions") || baseUrl.endsWith(OPENAI_ENDPOINTS.CHAT_COMPLETIONS)) {
        apiUrl = baseUrl;
      } else if (baseUrl.endsWith("/v1")) {
        apiUrl = `${baseUrl}/chat/completions`;
      } else {
        apiUrl = `${baseUrl}${OPENAI_ENDPOINTS.CHAT_COMPLETIONS}`;
      }
    }

    if (!apiUrl) {
      throw new Error(
        `Backend URL is not properly configured for ${format} format client. ` +
          `Check your config.json file - make sure backends.defaultBaseUrls is set correctly for your backend mode.`,
      );
    }

    const fullUrl = format === FORMAT_OLLAMA ? `${apiUrl}${endpointPath}` : apiUrl;

    this.logRequest(backendPayload, backendHeaders, format, fullUrl, stream);

    try {
      const response: AxiosResponse<OpenAIResponse | OllamaResponse | Readable> = await this.postWithRetries(
        fullUrl,
        backendPayload,
        {
          headers: backendHeaders,
          responseType: stream ? "stream" : "json",
        },
        2, // retries
        500, // base delay
      );

      logger.debug(
        `[BACKEND RESPONSE] Status: ${response.status} (${response.headers["content-type"] ?? "N/A"})`,
      );

      return response.data;
    } catch (error: unknown) {
      throw await this.handleRequestError(error as AxiosError, format, fullUrl);
    }
  }
}

export const backendService = new BackendServiceImpl();
