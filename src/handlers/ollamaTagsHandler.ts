/**
 * Ollama /api/tags Handler
 *
 * Intercepts /api/tags responses to ensure all models advertise tool support.
 * This is critical because clients check model capabilities before sending tool requests.
 */

import axios from 'axios';

import { BACKEND_LLM_BASE_URL } from '../config.js';
import { logger } from '../logging/index.js';

import type { Request, Response } from 'express';

interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

/**
 * Handler for /api/tags endpoint
 * Ensures all models advertise tool support
 */
export default async function ollamaTagsHandler(_req: Request, res: Response): Promise<void> {
  try {
    const backendUrl = `${BACKEND_LLM_BASE_URL}/api/tags`;

    logger.debug(`[OLLAMA TAGS] Proxying to: ${backendUrl}`);

    // Forward request to backend
    const response = await axios.get<OllamaTagsResponse>(backendUrl, {
      validateStatus: () => true, // Accept any status code
    });

    logger.debug(`[OLLAMA TAGS] Backend response status: ${response.status}`);

    // If error response, just forward it
    if (response.status !== 200) {
      res.status(response.status).json(response.data);
      return;
    }

    // Modify response to ensure all models advertise tool support
    const modifiedResponse = { ...response.data };

    if (Array.isArray(modifiedResponse.models)) {
      logger.debug(`[OLLAMA TAGS] Proxied ${modifiedResponse.models.length} models (tool support via template modification)`);
      logger.debug(`[OLLAMA TAGS] Response content:`, JSON.stringify(modifiedResponse, null, 2));
    }

    // Send modified response
    res.status(200).json(modifiedResponse);
  } catch (error) {
    logger.error('[OLLAMA TAGS] Error:', error);

    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        res.status(503).json({
          error: 'Service Unavailable',
          message: `Cannot connect to Ollama backend at ${BACKEND_LLM_BASE_URL}`,
        });
      } else if (error.response) {
        res.status(error.response.status).json(error.response.data);
      } else {
        res.status(502).json({
          error: 'Bad Gateway',
          message: error.message,
        });
      }
    } else {
      res.status(500).json({
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
