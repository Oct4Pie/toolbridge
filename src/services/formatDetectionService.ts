/**
 * Format Detection Service Implementation
 *
 * SSOT for format detection and provider determination.
 * This is the canonical implementation - all detection must go through here.
 */

import { OLLAMA_ENDPOINTS } from '../constants/endpoints.js';
import { FORMAT_OLLAMA, FORMAT_OPENAI } from '../handlers/formatDetector.js';
import { logger } from '../logging/index.js';
import { isOllamaFormat } from '../translation/detection/ollama.js';
import { isOpenAIFormat } from '../translation/detection/openai.js';
import { formatToProvider } from '../translation/utils/providerMapping.js';

import type { FormatDetectionService } from './contracts.js';
import type { LLMProvider } from '../translation/types/index.js';
import type { RequestFormat } from '../types/index.js';

class FormatDetectionServiceImpl implements FormatDetectionService {
  detectRequestFormat(
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
    url?: string
  ): RequestFormat {
    // 1. URL-based detection takes precedence (most reliable for chat endpoints)
    if (url) {
      // Ollama endpoints: /api/chat, /api/generate, /api/tags, /api/show, etc.
      if (url.includes(OLLAMA_ENDPOINTS.CHAT) || url.includes(OLLAMA_ENDPOINTS.GENERATE) ||
          url.includes(OLLAMA_ENDPOINTS.SHOW) || url.includes(OLLAMA_ENDPOINTS.TAGS)) {
        logger.debug(`[FORMAT] Detected client format via URL: ${FORMAT_OLLAMA}`);
        return FORMAT_OLLAMA;
      }

      // OpenAI endpoints: /v1/chat/completions, /v1/completions, /v1/models, etc.
      if (url.includes('/v1/')) {
        logger.debug(`[FORMAT] Detected client format via URL: ${FORMAT_OPENAI}`);
        return FORMAT_OPENAI;
      }
    }

    // 2. Header-based detection (x-api-format)
    const explicitFormat = headers['x-api-format']?.toString().toLowerCase() as RequestFormat;
    if (explicitFormat === FORMAT_OLLAMA) {
      logger.debug(`[FORMAT] Detected client format via header: ${FORMAT_OLLAMA}`);
      return FORMAT_OLLAMA;
    }
    if (explicitFormat === FORMAT_OPENAI) {
      logger.debug(`[FORMAT] Detected client format via header: ${FORMAT_OPENAI}`);
      return FORMAT_OPENAI;
    }

    // 3. Body-based detection
    if (typeof body !== 'object' || body === null) {
      logger.debug('[FORMAT] Request body is missing or not an object. Defaulting to OpenAI format.');
      return FORMAT_OPENAI;
    }

    if (isOllamaFormat(body)) {
      logger.debug(`[FORMAT] Inferred client format from body: ${FORMAT_OLLAMA}`);
      return FORMAT_OLLAMA;
    }

    if (isOpenAIFormat(body)) {
      logger.debug(`[FORMAT] Inferred client format from body: ${FORMAT_OPENAI}`);
      return FORMAT_OPENAI;
    }

    // 4. Default fallback
    logger.debug('[FORMAT] Could not confidently detect request format. Defaulting to OpenAI format.');
    return FORMAT_OPENAI;
  }

  detectResponseFormat(response: unknown): RequestFormat {
    if (response === null || response === undefined) {
      return FORMAT_OPENAI; // Default fallback
    }

    let parsedResponse: Record<string, unknown>;

    // Parse string responses
    if (typeof response === 'string') {
      try {
        const jsonString = response.startsWith('data: ') ? response.slice(6) : response;

        if (jsonString.trim() === '[DONE]') {
          return FORMAT_OPENAI;
        }

        parsedResponse = JSON.parse(jsonString) as Record<string, unknown>;
      } catch {
        return FORMAT_OPENAI; // Default on parse error
      }
    } else if (typeof response === 'object') {
      parsedResponse = response as Record<string, unknown>;
    } else {
      return FORMAT_OPENAI; // Default for non-object/string
    }

    // Check format
    if (isOllamaFormat(parsedResponse)) {
      return FORMAT_OLLAMA;
    }

    if (isOpenAIFormat(parsedResponse)) {
      return FORMAT_OPENAI;
    }

    return FORMAT_OPENAI; // Default fallback
  }

  determineProvider(format: RequestFormat, url: string): 'openai' | 'ollama' {
    // Provider determination based on format and URL patterns
    if (format === FORMAT_OLLAMA || url.includes('ollama') || url.includes(':11434')) {
      return 'ollama';
    }

    return 'openai'; // Default
  }

  getProviderFromFormat(format: RequestFormat): LLMProvider {
    return formatToProvider(format);
  }
}

export const formatDetectionService = new FormatDetectionServiceImpl();
