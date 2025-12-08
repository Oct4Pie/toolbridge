import { logger } from "../logging/index.js";
import { translationService, formatDetectionService } from "../services/index.js";
import { extractToolCallsUnified } from "../parsers/xml/index.js";
import {
  extractErrorMessage,
  createOpenAIErrorPayload,
  createOllamaErrorPayload,
} from "../utils/http/errorResponseHandler.js";

import { FORMAT_OLLAMA, FORMAT_OPENAI } from "./formatDetector.js";

import type { RequestFormat, OpenAIResponse, OllamaResponse, OllamaResponseFields } from "../types/index.js";

/**
 * Process XML tool calls in an OpenAI response
 * Mutates the response in place if tool calls are found
 */
function processOpenAIXMLToolCalls(
  response: OpenAIResponse,
  knownToolNames: string[]
): void {
  if (knownToolNames.length === 0) return;

  const choice = response.choices?.[0];
  if (!choice?.message?.content) return;

  // Skip if already has native tool_calls
  if (choice.message.tool_calls && choice.message.tool_calls.length > 0) return;

  const content = choice.message.content;
  const extractedCalls = extractToolCallsUnified(content, knownToolNames);

  if (extractedCalls.length > 0) {
    logger.debug(`[NON-STREAMING] Extracted ${extractedCalls.length} XML tool call(s) from OpenAI response`);

    choice.message.tool_calls = extractedCalls.map((call, index) => ({
      id: `call_${Date.now()}_${index}`,
      type: 'function' as const,
      function: {
        name: call.name,
        arguments: typeof call.arguments === 'string'
          ? call.arguments
          : JSON.stringify(call.arguments ?? {}),
      },
    }));

    // Remove the XML content from the message
    choice.message.content = null;
    choice.finish_reason = 'tool_calls';
  }
}

/**
 * Process XML tool calls in an Ollama response
 * Mutates the response in place if tool calls are found
 */
function processOllamaXMLToolCalls(
  response: OllamaResponse,
  knownToolNames: string[]
): void {
  if (knownToolNames.length === 0) return;

  // Cast to field-based type for unified access
  const resp = response as unknown as OllamaResponseFields;

  const content = resp.message?.content || resp.response;
  if (!content) return;

  // Skip if already has native tool_calls
  const existingToolCalls = resp.message?.tool_calls;
  if (Array.isArray(existingToolCalls) && existingToolCalls.length > 0) return;

  const extractedCalls = extractToolCallsUnified(content, knownToolNames);

  if (extractedCalls.length > 0) {
    logger.debug(`[NON-STREAMING] Extracted ${extractedCalls.length} XML tool call(s) from Ollama response`);

    const toolCalls = extractedCalls.map((call, index) => ({
      id: `call_${Date.now()}_${index}`,
      function: {
        index,
        name: call.name,
        arguments: typeof call.arguments === 'object'
          ? call.arguments as Record<string, unknown>
          : JSON.parse(String(call.arguments) || '{}') as Record<string, unknown>,
      },
    }));

    if (resp.message) {
      resp.message.tool_calls = toolCalls;
      resp.message.content = '';
    }
    // Clear response text since it's now a tool call
    resp.response = '';
  }
}

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
      "[NON-STREAMING] Formats match. Processing XML tool calls before returning.",
    );

    // Even when formats match, we must still process XML tool calls
    if (knownToolNames.length > 0 && backendResponse && typeof backendResponse === 'object') {
      if (clientFormat === FORMAT_OPENAI) {
        processOpenAIXMLToolCalls(backendResponse as OpenAIResponse, knownToolNames);
      } else if (clientFormat === FORMAT_OLLAMA) {
        processOllamaXMLToolCalls(backendResponse as OllamaResponse, knownToolNames);
      }
    }

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
    const errorMessage = extractErrorMessage(error);
    logger.error(
      `[NON-STREAMING] Error converting response from ${backendFormat} to ${clientFormat}:`,
      errorMessage,
    );

    const fullMessage = `Failed to convert backend response from ${backendFormat} to ${clientFormat}. Details: ${errorMessage}`;

    if (clientFormat === FORMAT_OPENAI) {
      return createOpenAIErrorPayload(fullMessage, 'proxy_conversion_error');
    }

    if (clientFormat === FORMAT_OLLAMA) {
      return createOllamaErrorPayload(fullMessage);
    }

    return { error: fullMessage };
  }
}