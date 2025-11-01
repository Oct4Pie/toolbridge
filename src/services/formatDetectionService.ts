/**
 * Format Detection Service Implementation
 * 
 * SSOT for format detection and provider determination.
 * Consolidates logic from formatDetector.ts and scattered utilities.
 */

import {
  detectRequestFormat as legacyDetectRequest,
  detectResponseFormat as legacyDetectResponse,
  FORMAT_OLLAMA,
} from '../handlers/formatDetector.js';
import { formatToProvider } from '../translation/utils/providerMapping.js';

import type { FormatDetectionService } from './contracts.js';
import type { LLMProvider } from '../translation/types/index.js';
import type { RequestFormat } from '../types/index.js';

class FormatDetectionServiceImpl implements FormatDetectionService {
  detectRequestFormat(
    body: unknown,
    headers: Record<string, string | string[] | undefined>
  ): RequestFormat {
    // Create a minimal request object for legacy detector
    const req = {
      body,
      headers,
    } as Parameters<typeof legacyDetectRequest>[0];

    return legacyDetectRequest(req);
  }

  detectResponseFormat(response: unknown): RequestFormat {
    const detected = legacyDetectResponse(response as Parameters<typeof legacyDetectResponse>[0]);
    // Filter out "unknown" type
    if (detected === 'unknown') {
      return 'openai'; // Default fallback
    }
    return detected;
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
