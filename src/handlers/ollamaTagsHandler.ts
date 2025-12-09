/**
 * Ollama /api/tags Handler
 *
 * CRITICAL: Supports bidirectional translation based on backend mode
 * - If backend=Ollama: Passthrough to Ollama backend
 * - If backend=OpenAI: Fetch from OpenAI and translate to Ollama format
 *
 * This ensures ALL endpoints translate based on the configured backend mode.
 *
 * SSOT: Uses ModelFetcher for bidirectional translation
 */

import { logger } from '../logging/index.js';
import { configService } from '../services/configService.js';
import { modelService } from '../services/index.js';
import { sendHTTPError } from '../utils/http/errorResponseHandler.js';
import { extractAuthHeader, sendSuccessJSON } from '../utils/http/handlerUtils.js';

import type { TagsResponse } from '../types/generated/ollama/tags.js';
import type { Request, Response } from 'express';

/**
 * Handler for /api/tags endpoint
 * Translates models based on backend mode
 */
export default async function ollamaTagsHandler(req: Request, res: Response): Promise<void> {
  try {
    const backendMode = configService.getBackendMode();
    const authHeader = extractAuthHeader(req);

    logger.info(`[OLLAMA TAGS] Request received from ${req.ip} (backend mode: ${backendMode})`);
    logger.info(`[OLLAMA TAGS] Authorization header present: ${authHeader ? 'YES' : 'NO'}`);
    if (authHeader) {
      logger.info(`[OLLAMA TAGS] Auth header format: ${authHeader.substring(0, 20)}...`);
    }

    const response = await modelService.listModels('ollama', authHeader) as TagsResponse;
    logger.debug(`[OLLAMA TAGS] Returning ${response.models.length} models (backend=${backendMode})`);

    sendSuccessJSON(res, response, 'OLLAMA TAGS');
  } catch (error) {
    sendHTTPError(res, error, 'OLLAMA TAGS');
  }
}
