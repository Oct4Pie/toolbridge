/**
 * Ollama /api/generate Handler
 *
 * Supports bidirectional translation between Ollama and OpenAI backends for the
 * legacy generate endpoint. Streaming responses are converted on the fly using
 * the universal translation layer while non-streaming responses reuse the
 * generic conversion utilities shared with the chat handler.
 */

import { logger } from "../logging/index.js";
import {
  backendService,
  configService,
  formatDetectionService,
  translationService,
} from "../services/index.js";
import { extractToolNames } from "../translation/utils/formatUtils.js";
import { handleStreamingBackendError, sendValidationError } from "../utils/http/errorResponseHandler.js";

import { FORMAT_OLLAMA, FORMAT_OPENAI } from "./formatDetector.js";
import { handleNonStreamingResponse } from "./nonStreamingHandler.js";

import type {
  OpenAITool,
  OllamaRequest,
  OllamaResponse,
  RequestFormat,
} from "../types/index.js";
import type { Request, Response } from "express";
import type { Readable } from "stream";

interface GenerateRequest extends Request {
  body: OllamaRequest;
}

const ollamaGenerateHandler = async (req: GenerateRequest, res: Response): Promise<void> => {
  logger.debug("\n--- New Ollama Generate Request ---");
  logger.debug("[CLIENT REQUEST] Headers:", JSON.stringify(req.headers, null, 2));
  logger.debug("[CLIENT REQUEST] Body:", JSON.stringify(req.body, null, 2));
  logger.debug("[CLIENT REQUEST] URL:", req.url);

  // Basic validation – Ollama generate requires a model plus either prompt or messages
  if (typeof req.body?.model !== "string" || req.body.model.trim() === "") {
    sendValidationError(res, 'Missing or invalid "model" in request body', 'OLLAMA GENERATE');
    return;
  }

  if (!req.body.prompt && (!Array.isArray(req.body.messages) || req.body.messages.length === 0)) {
    sendValidationError(res, 'Missing "prompt" or "messages" in request body', 'OLLAMA GENERATE');
    return;
  }

  // Normalize legacy prompt to messages early so downstream logging/debugging is easier
  if (req.body.prompt && !req.body.messages) {
    req.body.messages = [{ role: 'user', content: req.body.prompt }];
    logger.debug('[FORMAT] Converted Ollama prompt to messages array for generate endpoint');
  }

  const clientFormat: RequestFormat = FORMAT_OLLAMA;
  const backendTargetFormat: RequestFormat = configService.getBackendMode() === 'ollama'
    ? FORMAT_OLLAMA
    : FORMAT_OPENAI;
  logger.debug(`[FORMAT] Target backend format for generate endpoint: ${backendTargetFormat}`);

  const clientProvider = formatDetectionService.getProviderFromFormat(clientFormat);
  const backendProvider = formatDetectionService.getProviderFromFormat(backendTargetFormat);

  // Use formatUtils SSOT for tool extraction instead of duplicating logic
  const originalTools: OpenAITool[] = Array.isArray(req.body.tools)
    ? (req.body.tools as OpenAITool[])
    : [];
  const knownToolNames = extractToolNames(originalTools);

  try {
    let backendPayload: unknown = req.body;

    if (clientFormat !== backendTargetFormat) {
      logger.debug(`[FORMAT] Translating generate request: ${clientProvider} -> ${backendProvider}`);

      backendPayload = await translationService.translateRequest(
        req.body,
        clientProvider,
        backendProvider,
        knownToolNames,
      );

      logger.debug('[CONVERTED REQUEST] Payload for backend:', JSON.stringify(backendPayload, null, 2));
    } else {
      logger.debug(`[FORMAT] Request format matches backend format. Passing through translation layer for tool injection.`);

      // Even when formats match, we need to pass through translation layer
      // to handle tool injection and other transformations
      backendPayload = await translationService.translateRequest(
        req.body,
        clientProvider,
        backendProvider,
        knownToolNames,
      );
    }

    const clientRequestedStream = Boolean(req.body.stream);
    const clientAuthHeader = req.headers.authorization;
    const clientHeaders = req.headers;
    const targetProvider = formatDetectionService.determineProvider(backendTargetFormat, configService.getBackendUrl());

    const backendResponseOrStream = await backendService.sendRequest(
      backendPayload,
      clientRequestedStream,
      backendTargetFormat,
      targetProvider,
      typeof clientAuthHeader === 'string' ? clientAuthHeader : undefined,
      clientHeaders,
    ) as OllamaResponse | Readable;

    if (!clientRequestedStream) {
      logger.debug('[RESPONSE] Received non-streaming generate response from backend.');

      const finalResponse = await handleNonStreamingResponse(
        backendResponseOrStream,
        clientFormat,
        backendTargetFormat,
        knownToolNames,
      ) as OllamaResponse;

      logger.debug('[FINAL RESPONSE] Sending generate result to client:', JSON.stringify(finalResponse, null, 2));
      res.json(finalResponse);
      return;
    }

    logger.debug('[RESPONSE] Received streaming generate response from backend. Initializing converter.');

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    translationService.setupStreamTranslation(
      backendResponseOrStream as Readable,
      res,
      clientFormat,
      backendTargetFormat,
      originalTools,
      {
        clientRequestBody: req.body,
      },
    );
  } catch (error: unknown) {
    handleStreamingBackendError(
      res,
      error,
      'Error processing ollama generate request',
      undefined // Use default error message format
    );
  }
};

export default ollamaGenerateHandler;
