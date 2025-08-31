import { convertResponse } from "../utils/formatConverters.js";
import logger from "../utils/logger.js";
import { extractToolCallFromWrapper } from "../utils/xmlToolParser.js";

import { FORMAT_OLLAMA, FORMAT_OPENAI } from "./formatDetector.js";

import type { RequestFormat, OpenAIResponse, OllamaResponse } from "../types/index.js";

export function handleNonStreamingResponse(
  backendResponse: OpenAIResponse | OllamaResponse | unknown,
  clientFormat: RequestFormat = FORMAT_OPENAI,
  backendFormat: RequestFormat = FORMAT_OPENAI,
  knownToolNames: string[] = [],
): OpenAIResponse | OllamaResponse | unknown {
  logger.debug(
    `[NON-STREAMING] Handling response. Backend format: ${backendFormat}, Client format: ${clientFormat}`,
  );

  // Check if response contains tool call XML and convert to OpenAI format
  if (
    clientFormat === FORMAT_OPENAI &&
    typeof backendResponse === 'object' &&
    backendResponse !== null &&
    'choices' in (backendResponse as Record<string, unknown>) &&
    Array.isArray((backendResponse as Record<string, unknown>).choices)
  ) {
    const br = backendResponse as Record<string, unknown>;
    const choices = br.choices;
    const firstChoice = Array.isArray(choices) ? (choices[0] as Record<string, unknown>) : undefined;
    const rawContent = firstChoice?.message && typeof (firstChoice.message as Record<string, unknown>).content === 'string'
      ? ((firstChoice.message as Record<string, unknown>).content as string)
      : undefined;

    // Try to extract tool call from wrapped XML in content (only if string)
    const toolCall = extractToolCallFromWrapper(rawContent, knownToolNames);

    if (toolCall?.name) {
      logger.debug(`[NON-STREAMING] Detected tool call: ${toolCall.name}`);
      
      // Convert XML tool call to OpenAI tool_calls format
      const toolCallId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create response with tool_calls instead of content
      // Build a minimal, valid OpenAIResponse instead of spreading unknown values
      const originalModel = typeof br.model === 'string' ? (br.model) : 'unknown-model';
      const nowSec = Math.floor(Date.now() / 1000);
      const originalChoice = Array.isArray(br.choices) ? (br.choices as unknown[])[0] as Record<string, unknown> : {} as Record<string, unknown>;

      const convertedResponse: OpenAIResponse = {
        id: `chatcmpl-proxy-${Date.now()}`,
        object: 'chat.completion',
        created: nowSec,
        model: originalModel,
  provider: typeof br.provider === 'string' ? (br.provider) : '',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: toolCallId,
                  type: 'function',
                    function: {
                    name: toolCall.name,
                    arguments: JSON.stringify(toolCall.arguments),
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
            logprobs: ('logprobs' in originalChoice) ? originalChoice.logprobs : undefined,
            native_finish_reason: ('native_finish_reason' in originalChoice) ? String(originalChoice.native_finish_reason) : '',
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };
      
  logger.debug("[NON-STREAMING] Converted XML to tool_calls format");
  return convertedResponse;
    }
  }

  if (clientFormat === backendFormat) {
    logger.debug(
      "[NON-STREAMING] Formats match. Returning backend response directly.",
    );
    return backendResponse as OpenAIResponse | OllamaResponse;
  } else {
    logger.debug(
      `[NON-STREAMING] Converting response: ${backendFormat} -> ${clientFormat}`,
    );
    try {
      const converted = convertResponse(
        backendFormat,
        clientFormat,
        backendResponse as OpenAIResponse | OllamaResponse,
      );
      logger.debug("[NON-STREAMING] Conversion successful.");
      return converted;
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
      } else if (clientFormat === FORMAT_OLLAMA) {
        return {
          error: errorPayload.error,
          done: true,
        };
      }

      return errorPayload;
    }
  }
}