
import { logger } from "../logging/index.js";
import { configService, translationService, formatDetectionService, backendService } from "../services/index.js";
import { extractToolNames } from "../translation/utils/formatUtils.js";
import { handleStreamingBackendError, sendValidationError } from "../utils/http/errorResponseHandler.js";

import {
  FORMAT_OLLAMA,
  FORMAT_OPENAI,
} from "./formatDetector.js";
import { handleNonStreamingResponse } from "./nonStreamingHandler.js";

import type {
  OpenAITool,
  OpenAIRequest,
  OpenAIResponse,
  OllamaRequest,
  OllamaResponse,
  RequestFormat,
} from "../types/index.js";
import type { Request, Response } from "express";
import type { Readable } from "stream";

interface ChatCompletionRequest extends Request {
  body: OpenAIRequest | OllamaRequest;
  headers: Request['headers'] & {
    authorization?: string | undefined;
    'x-backend-format'?: RequestFormat | undefined;
  };
}

interface ChatCompletionResponse extends Response {
  json(body: OpenAIResponse | { error: string }): this;
}

/**
 * Chat completions handler - thin HTTP adapter
 * All business logic delegated to services
 */

const isExplicitOllamaAuth = (authHeader: string | undefined): boolean => {
  if (!authHeader) {
    return false;
  }

  return authHeader.trim().toLowerCase() === "bearer ollama";
};

const shouldRetryWithOllama = (
  error: unknown,
  previousTargetFormat: RequestFormat,
  clientFormat: RequestFormat,
  requestBody: OpenAIRequest | OllamaRequest
): boolean => {
  if (previousTargetFormat === FORMAT_OLLAMA || clientFormat !== FORMAT_OLLAMA) {
    return false;
  }

  if (!error || typeof error !== 'object') {
    return false;
  }

  const messageParts: string[] = [];
  const genericError = error as { message?: string };
  if (typeof genericError.message === 'string') {
    messageParts.push(genericError.message);
  }

  const responseError = (error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message;
  if (typeof responseError === 'string') {
    messageParts.push(responseError);
  }

  const combinedMessage = messageParts.join(' ').toLowerCase();
  if (!combinedMessage.includes('not a valid model id')) {
    return false;
  }

  const candidateModel = (requestBody as OllamaRequest).model;
  if (typeof candidateModel === 'string' && candidateModel.includes('/')) {
    return false;
  }

  return true;
};

const chatCompletionsHandler = async (
  req: ChatCompletionRequest,
  res: ChatCompletionResponse
): Promise<void> => {
  logger.debug("\n--- New Chat Completions Request ---");
  logger.debug(
    "[CLIENT REQUEST] Headers:",
    JSON.stringify(req.headers, null, 2),
  );
  logger.debug("[CLIENT REQUEST] Body:", JSON.stringify(req.body, null, 2));
  logger.debug("[CLIENT REQUEST] URL:", req.url);

  const clientRequestFormat: RequestFormat = formatDetectionService.detectRequestFormat(
    req.body,
    req.headers,
    req.url
  );
  logger.debug(
    `[FORMAT] Detected client request format: ${clientRequestFormat} (from URL: ${req.url})`,
  );

  // Extract model name to determine backend (for auto mode)
  // Determine backend format - backend mode is explicitly set, never 'auto'
  let backendTargetFormat: RequestFormat = configService.getBackendMode() === 'ollama'
    ? FORMAT_OLLAMA
    : FORMAT_OPENAI;

  const clientProvider = formatDetectionService.getProviderFromFormat(clientRequestFormat);

  // Type-safe validation
  if (clientRequestFormat === FORMAT_OPENAI) {
    const openaiBody = req.body as OpenAIRequest;
    if (openaiBody.messages.length === 0) {
      sendValidationError(res, 'Missing or invalid "messages" in OpenAI request body', 'CHAT HANDLER');
      return;
    }
  } else if (clientRequestFormat === FORMAT_OLLAMA) {
    const ollamaBody = req.body as OllamaRequest;
    if (!ollamaBody.prompt && (!ollamaBody.messages || ollamaBody.messages.length === 0)) {
      sendValidationError(res, 'Missing "prompt" or "messages" in Ollama request body', 'CHAT HANDLER');
      return;
    }
  }

  // Ollama prompt→messages conversion is handled by OllamaConverter.toGeneric()
  // No direct manipulation needed here - the translation layer handles it

  try {
    // Extract tools from request body (both OpenAI and Ollama formats support tools field)
    // Use formatUtils SSOT for tool extraction instead of duplicating logic
    const requestBody = req.body as OpenAIRequest | OllamaRequest;
    const originalTools: OpenAITool[] = Array.isArray(requestBody.tools)
      ? requestBody.tools as OpenAITool[]
      : [];
    const streamOptions = (req.body as OpenAIRequest).stream_options;
    const knownToolNames: string[] = extractToolNames(originalTools);

    const translateForBackend = async (targetFormat: RequestFormat): Promise<unknown> => {
      const targetProviderForTranslate = formatDetectionService.getProviderFromFormat(targetFormat);

      if (clientRequestFormat !== targetFormat) {
        logger.debug(
          `[FORMAT] Converting request via translation engine: ${clientProvider} -> ${targetProviderForTranslate}`,
        );
      } else {
        logger.debug(
          `[FORMAT] Request format matches backend format (${clientRequestFormat}). Passing through translation layer for tool injection.`,
        );
      }

      const translated = await translationService.translateRequest(
        req.body,
        clientProvider,
        targetProviderForTranslate,
        knownToolNames,
      );

      logger.debug(
        "[CONVERTED REQUEST] Payload for backend:",
        JSON.stringify(translated, null, 2),
      );

      return translated;
    };

    const clientRequestedStream: boolean = Boolean((req.body).stream);
    const clientAuthHeader: string | undefined = req.headers.authorization;
    const explicitOllamaAuth = isExplicitOllamaAuth(clientAuthHeader);
    const clientHeaders: Record<string, string | string[] | undefined> = req.headers;

    if (explicitOllamaAuth && clientRequestFormat === FORMAT_OPENAI) {
      backendTargetFormat = FORMAT_OLLAMA;
    }

    logger.debug(`[FORMAT] Target backend format: ${backendTargetFormat}`);

    let backendPayload: unknown = await translateForBackend(backendTargetFormat);

    let targetProvider = explicitOllamaAuth
      ? 'ollama'
      : formatDetectionService.determineProvider(backendTargetFormat, configService.getBackendUrl());
    logger.debug(`[PROVIDER] Target provider determined: ${targetProvider}`);

    let backendResponseOrStream: OpenAIResponse | OllamaResponse | Readable;

    try {
      backendResponseOrStream = await backendService.sendRequest(
        backendPayload,
        clientRequestedStream,
        backendTargetFormat,
        targetProvider,
        clientAuthHeader,
        clientHeaders,
      ) as OpenAIResponse | OllamaResponse | Readable;
    } catch (error: unknown) {
      if (!shouldRetryWithOllama(error, backendTargetFormat, clientRequestFormat, requestBody)) {
        throw error;
      }

      logger.warn("[PROVIDER] Falling back to Ollama backend after invalid model response from OpenAI provider.");
      backendTargetFormat = FORMAT_OLLAMA;
      backendPayload = await translateForBackend(backendTargetFormat);
      targetProvider = 'ollama';
      logger.debug(`[FORMAT] Target backend format after fallback: ${backendTargetFormat}`);
      logger.debug(`[PROVIDER] Target provider determined: ${targetProvider}`);

      backendResponseOrStream = await backendService.sendRequest(
        backendPayload,
        clientRequestedStream,
        backendTargetFormat,
        targetProvider,
        undefined,
        clientHeaders,
      ) as OpenAIResponse | OllamaResponse | Readable;
    }

    if (!clientRequestedStream) {
      logger.debug("[RESPONSE] Received non-streaming response from backend.");

      const finalResponse = await handleNonStreamingResponse(
        backendResponseOrStream,
        clientRequestFormat,
        backendTargetFormat,
        knownToolNames,
      ) as OpenAIResponse;

      logger.debug(
        "[FINAL RESPONSE] Sending to client:",
        JSON.stringify(finalResponse, null, 2),
      );
      res.json(finalResponse);
    } else {
      logger.debug(
        "[RESPONSE] Received stream from backend. Setting up stream handler.",
      );

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const translationOptions: {
        streamOptions?: { include_usage?: boolean };
        clientRequestBody: OpenAIRequest | OllamaRequest;
      } = {
        clientRequestBody: req.body,
      };

      if (streamOptions) {
        translationOptions.streamOptions = streamOptions;
      }

      translationService.setupStreamTranslation(
        backendResponseOrStream as Readable,
        res,
        clientRequestFormat,
        backendTargetFormat,
        originalTools,
        translationOptions,
      );
    }
  } catch (error: unknown) {
    handleStreamingBackendError(
      res,
      error,
      'Error processing chat completion request',
      undefined // Use default error message format
    );
  }
};

export default chatCompletionsHandler;