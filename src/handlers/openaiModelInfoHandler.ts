/**
 * OpenAI /v1/models/:model Handler
 *
 * Returns OpenAI-formatted model metadata for any backend provider.
 */

import { logger } from '../logging/index.js';
import { modelService } from '../services/index.js';
import { sendHTTPError, sendValidationError } from '../utils/http/errorResponseHandler.js';
import { getBackendContext, sendSuccessJSON } from '../utils/http/handlerUtils.js';

import type { Request, Response } from 'express';

export default async function openaiModelInfoHandler(req: Request, res: Response): Promise<void> {
  const modelId = req.params['model'] ?? req.params['modelId'];

  if (!modelId) {
    sendValidationError(res, 'Model identifier is required', 'OPENAI MODEL INFO');
    return;
  }

  try {
    const { backendMode, authHeader } = getBackendContext(req);

    logger.info(`[OPENAI MODEL INFO] Fetching model="${modelId}" for backend=${backendMode}`);

    const response = await modelService.getModelInfo(modelId, 'openai', authHeader);

    sendSuccessJSON(res, response, 'OPENAI MODEL INFO');
  } catch (error: unknown) {
    sendHTTPError(res, error, 'OPENAI MODEL INFO');
  }
}
