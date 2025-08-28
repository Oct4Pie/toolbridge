
import { convertRequest } from "../utils/formatConverters.js";
import logger from "../utils/logger.js";

import { callBackendLLM } from "./backendLLM.js";
import {
  FORMAT_OLLAMA,
  FORMAT_OPENAI,
  detectRequestFormat,
} from "./formatDetector.js";
import { handleNonStreamingResponse } from "./nonStreamingHandler.js";
import { buildBackendPayload } from "./payloadHandler.js";
import { setupStreamHandler } from "./streamingHandler.js";

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

  const clientRequestFormat: RequestFormat = detectRequestFormat(req);
  logger.debug(
    `[FORMAT] Detected client request format: ${clientRequestFormat}`,
  );

  const backendTargetFormat: RequestFormat = (req.headers["x-backend-format"] ?? FORMAT_OPENAI);
  logger.debug(`[FORMAT] Target backend format: ${backendTargetFormat}`);

  // Type-safe validation
  if (clientRequestFormat === FORMAT_OPENAI) {
    const openaiBody = req.body as OpenAIRequest;
    if (openaiBody.messages === null || openaiBody.messages === undefined || openaiBody.messages.length === 0) {
      res.status(400).json({ error: 'Missing "messages" in OpenAI request body' });
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
    let backendPayload: BackendPayload = req.body as BackendPayload;
    
    if (clientRequestFormat !== backendTargetFormat) {
      logger.debug(
        `[FORMAT] Converting request: ${clientRequestFormat} -> ${backendTargetFormat}`,
      );
      backendPayload = convertRequest(
        clientRequestFormat,
        backendTargetFormat,
        req.body,
      );
      logger.debug(
        "[CONVERTED REQUEST] Payload for backend:",
        JSON.stringify(backendPayload, null, 2),
      );
    } else {
      logger.debug(
        `[FORMAT] Request format matches backend format (${clientRequestFormat}). No conversion needed.`,
      );
    }

    // Extract tools BEFORE buildBackendPayload removes them
  const originalTools: OpenAITool[] = (req.body as OpenAIRequest).tools ?? [];

    if (backendTargetFormat === FORMAT_OPENAI) {
      const payloadWithTools = {
        ...backendPayload,
        tools: originalTools,
        messages: backendPayload.messages as OpenAIMessage[]
      };
      backendPayload = buildBackendPayload(payloadWithTools as Parameters<typeof buildBackendPayload>[0]);
    }

    const clientRequestedStream: boolean = Boolean((req.body).stream);
    const clientAuthHeader: string | undefined = req.headers.authorization;
    const clientHeaders: Record<string, string | string[] | undefined> = req.headers;

    const backendResponseOrStream: OpenAIResponse | OllamaResponse | Readable = await callBackendLLM(
      backendPayload,
      clientRequestedStream,
      clientAuthHeader,
      clientHeaders,
      backendTargetFormat,
    );

    if (!clientRequestedStream) {
      logger.debug("[RESPONSE] Received non-streaming response from backend.");

      // Extract tool names for XML parsing
      const knownToolNames: string[] = originalTools
        .map((t: OpenAITool) => t.function.name)
        .filter((name): name is string => Boolean(name));
      
      const finalResponse: OpenAIResponse = handleNonStreamingResponse(
        backendResponseOrStream as OpenAIResponse,
        clientRequestFormat,
        backendTargetFormat,
        knownToolNames,
      );

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

      setupStreamHandler(
        backendResponseOrStream as Readable,
        res,
        clientRequestFormat,
        backendTargetFormat,
        originalTools,
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