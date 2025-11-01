
import { logger } from "../logging/index.js";
import { configService, translationService, formatDetectionService, backendService } from "../services/index.js";

import {
  FORMAT_OLLAMA,
  FORMAT_OPENAI,
} from "./formatDetector.js";
import { handleNonStreamingResponse } from "./nonStreamingHandler.js";
import { buildBackendPayload } from "./payloadHandler.js";

import type {
  OpenAITool,
  OpenAIMessage,
  OpenAIRequest,
  OpenAIResponse,
  OllamaRequest,
  OllamaResponse,
  RequestFormat,
  BackendError,
  BackendPayload
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

  const clientRequestFormat: RequestFormat = formatDetectionService.detectRequestFormat(req.body, req.headers);
  logger.debug(
    `[FORMAT] Detected client request format: ${clientRequestFormat}`,
  );

  // Backend format from config.json (SSOT)
  const backendTargetFormat: RequestFormat = (() => {
    const mode = configService.getBackendMode();
    if (mode === 'ollama') {
      return FORMAT_OLLAMA;
    }
    return FORMAT_OPENAI;
  })();
  logger.debug(`[FORMAT] Target backend format: ${backendTargetFormat}`);

  const clientProvider = formatDetectionService.getProviderFromFormat(clientRequestFormat);
  const backendProvider = formatDetectionService.getProviderFromFormat(backendTargetFormat);

  // Type-safe validation
  if (clientRequestFormat === FORMAT_OPENAI) {
    const openaiBody = req.body as OpenAIRequest;
    if (openaiBody.messages.length === 0) {
      res.status(400).json({ error: 'Missing or invalid "messages" in OpenAI request body' });
      return;
    }
  } else if (clientRequestFormat === FORMAT_OLLAMA) {
    const ollamaBody = req.body as OllamaRequest;
    if (!ollamaBody.prompt && !ollamaBody.messages) {
      res.status(400).json({ error: 'Missing "prompt" or "messages" in Ollama request body' });
      return;
    }
  }

  try {
    const originalTools: OpenAITool[] = (req.body as OpenAIRequest).tools ?? [];
    const streamOptions = (req.body as OpenAIRequest).stream_options;
    const knownToolNames: string[] = originalTools
      .map((tool) => tool.function.name)
      .filter((name): name is string => Boolean(name));

    let backendPayload: BackendPayload = req.body as BackendPayload;

    if (clientRequestFormat !== backendTargetFormat) {
      logger.debug(
        `[FORMAT] Converting request via translation engine: ${clientProvider} -> ${backendProvider}`,
      );

      const translatedPayload = await translationService.translateRequest(
        req.body,
        clientProvider,
        backendProvider,
        knownToolNames,
      );

      backendPayload = translatedPayload as BackendPayload;

      logger.debug(
        "[CONVERTED REQUEST] Payload for backend:",
        JSON.stringify(backendPayload, null, 2),
      );
    } else {
      logger.debug(
        `[FORMAT] Request format matches backend format (${clientRequestFormat}). No conversion needed.`,
      );
    }

    if (backendTargetFormat === FORMAT_OPENAI) {
      const payloadWithTools = {
        ...backendPayload,
        tools: originalTools,
        messages: backendPayload.messages as OpenAIMessage[],
      };
      backendPayload = buildBackendPayload(payloadWithTools as Parameters<typeof buildBackendPayload>[0]);
    }

    const clientRequestedStream: boolean = Boolean((req.body).stream);
    const clientAuthHeader: string | undefined = req.headers.authorization;
    const clientHeaders: Record<string, string | string[] | undefined> = req.headers;

  // Determine the target provider (openai or ollama)
    const targetProvider = formatDetectionService.determineProvider(backendTargetFormat, configService.getBackendUrl());
    logger.debug(`[PROVIDER] Target provider determined: ${targetProvider}`);

    const backendResponseOrStream: OpenAIResponse | OllamaResponse | Readable = await backendService.sendRequest(
      backendPayload,
      clientRequestedStream,
      backendTargetFormat,
      targetProvider,
      clientAuthHeader,
      clientHeaders,
    ) as OpenAIResponse | OllamaResponse | Readable;

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

      translationService.setupStreamTranslation(
        backendResponseOrStream as Readable,
        res,
        clientRequestFormat,
        backendTargetFormat,
        originalTools,
        streamOptions,
      );
    }
  } catch (error: unknown) {
    const backendError = error as BackendError;
    
    logger.error("\n--- Error processing chat completion request ---");
    logger.error("Error Message:", backendError.message);
    
    if (backendError.stack) {
      logger.error("Stack Trace:", backendError.stack);
    }
    if (backendError.response) {
      logger.error("Backend Response Status:", backendError.response.status);
      logger.error("Backend Response Data:", backendError.response.data);
    } else if (backendError.request) {
      logger.error("Backend Request Data:", backendError.request);
    }

    if (!res.headersSent) {
      const statusCode = backendError.status ?? 500;
      res.status(statusCode).json({
        error: `Failed to process chat completion. Status: ${statusCode}. Message: ${backendError.message}`,
      });
    } else if (!res.writableEnded) {
      logger.error("[ERROR] Headers already sent, attempting to end stream.");
      res.end();
    } else {
      logger.error(
        "[ERROR] Headers sent and stream ended. Cannot send error response.",
      );
    }
  }
};

export default chatCompletionsHandler;