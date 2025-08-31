
import { isOllamaFormat } from "../utils/format/ollama/detector.js";
import { isOpenAIFormat } from "../utils/format/openai/detector.js";
import logger from "../utils/logger.js";

import type { RequestFormat, OpenAIRequest, OllamaRequest, OpenAIResponse, OllamaResponse } from "../types/index.js";
import type { Request } from "express";

export const FORMAT_OPENAI: RequestFormat = "openai";
export const FORMAT_OLLAMA: RequestFormat = "ollama";
export const FORMAT_UNKNOWN = "unknown";

interface RequestWithFormat extends Request {
  body: OpenAIRequest | OllamaRequest | Record<string, unknown>;
  headers: Request['headers'] & {
    'x-api-format'?: string;
  };
}

export function detectRequestFormat(req: RequestWithFormat): RequestFormat {
  const explicitFormat = req.headers["x-api-format"]?.toLowerCase() as RequestFormat;
  
  if (explicitFormat === FORMAT_OLLAMA) {
    logger.debug(
      `[FORMAT] Detected client format via header: ${FORMAT_OLLAMA}`,
    );
    return FORMAT_OLLAMA;
  }
  
  if (explicitFormat === FORMAT_OPENAI) {
    logger.debug(
      `[FORMAT] Detected client format via header: ${FORMAT_OPENAI}`,
    );
    return FORMAT_OPENAI;
  }

  const body = req.body;
  if (typeof body !== "object") {
    logger.debug(
      "[FORMAT] Request body is missing or not an object. Cannot infer format.",
    );
    return FORMAT_OPENAI; // Default to OpenAI format instead of unknown
  }

  if (isOllamaFormat(body)) {
    logger.debug(`[FORMAT] Inferred client format from body: ${FORMAT_OLLAMA}`);
    return FORMAT_OLLAMA;
  }
  
  if (isOpenAIFormat(body)) {
    logger.debug(`[FORMAT] Inferred client format from body: ${FORMAT_OPENAI}`);
    return FORMAT_OPENAI;
  }

  logger.debug(
    "[FORMAT] Could not confidently detect request format from header or body. Defaulting to OpenAI format.",
  );
  return FORMAT_OPENAI;
}

type ResponseFormatInput = string | OpenAIResponse | OllamaResponse | Record<string, unknown> | null | undefined;

export function detectResponseFormat(response: ResponseFormatInput): RequestFormat | typeof FORMAT_UNKNOWN {
  if (response === null || response === undefined) {return FORMAT_UNKNOWN;}

  let parsedResponse: Record<string, unknown>;

  if (typeof response === "string") {
    try {
      const jsonString = response.startsWith("data: ")
        ? response.slice(6)
        : response;

      if (jsonString.trim() === "[DONE]") {return FORMAT_OPENAI;}
      parsedResponse = JSON.parse(jsonString) as Record<string, unknown>;
    } catch {
      return FORMAT_UNKNOWN;
    }
  } else if (typeof response === "object") {
    parsedResponse = response as Record<string, unknown>;
  } else {
    return FORMAT_UNKNOWN;
  }

  if (isOllamaFormat(parsedResponse)) {
    return FORMAT_OLLAMA;
  }
  
  if (isOpenAIFormat(parsedResponse)) {
    return FORMAT_OPENAI;
  }

  return FORMAT_UNKNOWN;
}