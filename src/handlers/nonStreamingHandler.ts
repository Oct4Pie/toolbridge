import { logger } from "../logging/index.js";
import { translationService, formatDetectionService } from "../services/index.js";

import { FORMAT_OLLAMA, FORMAT_OPENAI } from "./formatDetector.js";

import type { RequestFormat, OpenAIResponse, OllamaResponse } from "../types/index.js";

export async function handleNonStreamingResponse(
  backendResponse: OpenAIResponse | OllamaResponse | unknown,
  clientFormat: RequestFormat = FORMAT_OPENAI,
  backendFormat: RequestFormat = FORMAT_OPENAI,
  knownToolNames: string[] = [],
): Promise<OpenAIResponse | OllamaResponse | unknown> {
  logger.debug(
    `[NON-STREAMING] Handling response. Backend format: ${backendFormat}, Client format: ${clientFormat}`,
  );

  if (clientFormat === backendFormat) {
    logger.debug(
      "[NON-STREAMING] Formats match. Returning backend response directly.",
    );
    return backendResponse as OpenAIResponse | OllamaResponse;
  }

  const sourceProvider = formatDetectionService.getProviderFromFormat(backendFormat);
  const targetProvider = formatDetectionService.getProviderFromFormat(clientFormat);

  logger.debug(
    `[NON-STREAMING] Converting response via translation engine: ${sourceProvider} -> ${targetProvider}`,
  );

  try {
    const translated = await translationService.translateResponse(
      backendResponse,
      sourceProvider,
      targetProvider,
      knownToolNames,
    );

    logger.debug("[NON-STREAMING] Translation successful.");
    return translated as OpenAIResponse | OllamaResponse | unknown;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(
      `[NON-STREAMING] Error converting response from ${backendFormat} to ${clientFormat}:`,
      errorMessage,
    );

    const errorPayload = {
      error: `Failed to convert backend response from ${backendFormat} to ${clientFormat}. Details: ${errorMessage}`,
    };

    if (clientFormat === FORMAT_OPENAI) {
      return {
        object: "error",
        message: errorPayload.error,
        type: "proxy_conversion_error",
        code: null,
        param: null,
      };
    }

    if (clientFormat === FORMAT_OLLAMA) {
      return {
        error: errorPayload.error,
        done: true,
      };
    }

    return errorPayload;
  }
}