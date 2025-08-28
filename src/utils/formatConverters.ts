import { FORMAT_OLLAMA, FORMAT_OPENAI } from "../handlers/formatDetector.js";

import {
  convertOllamaRequestToOllama,
  convertOpenAIRequestToOllama,
} from "./format/ollama/requestConverter.js";
import { convertOpenAIResponseToOllama } from "./format/ollama/responseConverter.js";
import {
  convertOllamaRequestToOpenAI as convertOllamaToOpenAIRequest,
  convertOpenAIRequestToOpenAI,
} from "./format/openai/requestConverter.js";
import { convertOllamaResponseToOpenAI as convertOllamaToOpenAIResponse } from "./format/openai/responseConverter.js";
import logger from "./logger.js";


import type {
  RequestFormat,
  OpenAIRequest,
  OllamaRequest,
  OpenAIResponse,
  OllamaResponse,
  OpenAIStreamChunk,
  OllamaStreamChunk,
  BackendPayload
} from "../types/index.js";

export function convertRequest(
  sourceFormat: RequestFormat,
  targetFormat: RequestFormat,
  request: OpenAIRequest | OllamaRequest
): BackendPayload {
  logger.debug(
    `[CONVERT] Converting request: ${sourceFormat} -> ${targetFormat}`,
  );
  
  if (sourceFormat === FORMAT_OPENAI && targetFormat === FORMAT_OPENAI) {
    return convertOpenAIRequestToOpenAI(request as OpenAIRequest) as BackendPayload;
  }
  if (sourceFormat === FORMAT_OPENAI && targetFormat === FORMAT_OLLAMA) {
    return convertOpenAIRequestToOllama(request as OpenAIRequest) as BackendPayload;
  }
  if (sourceFormat === FORMAT_OLLAMA && targetFormat === FORMAT_OPENAI) {
    return convertOllamaToOpenAIRequest(request as OllamaRequest) as BackendPayload;
  }
  if (sourceFormat === FORMAT_OLLAMA && targetFormat === FORMAT_OLLAMA) {
    return convertOllamaRequestToOllama(request as OllamaRequest) as BackendPayload;
  }
  
  logger.error(
    `[CONVERT] Unsupported request conversion: ${sourceFormat} -> ${targetFormat}`,
  );
  throw new Error(
    `Unsupported request conversion: ${sourceFormat} -> ${targetFormat}`,
  );
}

export function convertResponse(
  sourceFormat: RequestFormat,
  targetFormat: RequestFormat,
  response: OpenAIResponse | OllamaResponse,
  isStreamChunk: boolean = false,
): OpenAIResponse | OllamaResponse | OpenAIStreamChunk | OllamaStreamChunk {
  if (!isStreamChunk) {
    logger.debug(
      `[CONVERT] Converting response: ${sourceFormat} -> ${targetFormat}`,
    );
  }

  if (sourceFormat === FORMAT_OPENAI && targetFormat === FORMAT_OPENAI) {
    return { ...response } as OpenAIResponse;
  }
  if (sourceFormat === FORMAT_OPENAI && targetFormat === FORMAT_OLLAMA) {
    return convertOpenAIResponseToOllama(response as OpenAIResponse);
  }
  if (sourceFormat === FORMAT_OLLAMA && targetFormat === FORMAT_OPENAI) {
    return convertOllamaToOpenAIResponse(response as OllamaResponse, isStreamChunk);
  }
  if (sourceFormat === FORMAT_OLLAMA && targetFormat === FORMAT_OLLAMA) {
    return { ...response } as OllamaResponse;
  }
  
  logger.error(
    `[CONVERT] Unsupported response conversion: ${sourceFormat} -> ${targetFormat}`,
  );
  throw new Error(
    `Unsupported response conversion: ${sourceFormat} -> ${targetFormat}`,
  );
}