/**
 * OpenAI /v1/models Handler
 *
 * Backend-agnostic model listing with automatic format translation.
 * Returns OpenAI-formatted model lists regardless of the backend provider.
 */

import { logger } from '../logging/index.js';
import { modelService } from '../services/index.js';
import { sendHTTPError } from '../utils/http/errorResponseHandler.js';
import { getBackendContext, sendSuccessJSON } from '../utils/http/handlerUtils.js';

import type { ModelsListResponse } from '../types/generated/openai/models-list.js';
import type { Request, Response } from 'express';

export default async function openaiModelsHandler(req: Request, res: Response): Promise<void> {
  try {
    const { backendMode, authHeader } = getBackendContext(req);

    logger.info(`[OPENAI MODELS] Listing models for backend=${backendMode}`);

    const response = await modelService.listModels('openai', authHeader) as ModelsListResponse;

    sendSuccessJSON(res, response, 'OPENAI MODELS');
  } catch (error: unknown) {
    sendHTTPError(res, error, 'OPENAI MODELS');
  }
}
