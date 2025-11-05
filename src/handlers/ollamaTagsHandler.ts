/**
 * Ollama /api/tags Handler
 *
 * CRITICAL: This is a LIST endpoint - must be a simple PASSTHROUGH.
 * Returns raw backend response WITHOUT any ToolBridge enhancements.
 *
 * Architecture Decision:
 * - /api/tags (this): Simple passthrough, matches native Ollama format exactly
 * - /api/show: Enhancement endpoint, adds ToolBridge capabilities
 *
 * SSOT: Direct backend proxy (no ModelService translation)
 */

import axios from 'axios';

import { logger } from '../logging/index.js';
import { configService } from '../services/configService.js';

import type { OllamaModelsResponse } from '../translation/types/models.js';
import type { Request, Response } from 'express';

/**
 * Handler for /api/tags endpoint
 * Returns simple model list from backend (passthrough, no capabilities)
 */
export default async function ollamaTagsHandler(req: Request, res: Response): Promise<void> {
  try {
    const backendUrl = configService.getOllamaBackendUrl();
    const authHeader = req.headers.authorization;

    logger.info(`[OLLAMA TAGS] Request received from ${req.ip}`);
    logger.info(`[OLLAMA TAGS] Authorization header present: ${authHeader ? 'YES' : 'NO'}`);
    if (authHeader) {
      logger.info(`[OLLAMA TAGS] Auth header format: ${authHeader.substring(0, 20)}...`);
    }
    logger.debug(`[OLLAMA TAGS] Proxying to backend: ${backendUrl}/api/tags (PASSTHROUGH)`);

    // CRITICAL: Direct passthrough to backend (no ModelService translation)
    // This ensures /api/tags returns EXACTLY what native Ollama returns
    // NO capabilities field, NO ToolBridge enhancements - pure backend response
    const backendResponse = await axios.get<OllamaModelsResponse>(
      `${backendUrl}/api/tags`,
      {
        headers: authHeader ? { 'Authorization': authHeader } : {},
        timeout: 30000,
      }
    );

    const response = backendResponse.data;
    logger.debug(`[OLLAMA TAGS] Returning ${response.models.length} models (passthrough, no modifications)`);

    if (configService.isDebugMode()) {
      logger.debug(`[OLLAMA TAGS] Response content:`, JSON.stringify(response, null, 2));
    }

    // Send raw backend response
    res.status(200).json(response);
  } catch (error) {
    logger.error('[OLLAMA TAGS] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('ECONNREFUSED')) {
      res.status(503).json({
        error: 'Service Unavailable',
        message: `Cannot connect to backend: ${errorMessage}`,
      });
    } else if (errorMessage.includes('Failed to fetch')) {
      res.status(502).json({
        error: 'Bad Gateway',
        message: errorMessage,
      });
    } else {
      res.status(500).json({
        error: 'Internal Server Error',
        message: errorMessage,
      });
    }
  }
}
