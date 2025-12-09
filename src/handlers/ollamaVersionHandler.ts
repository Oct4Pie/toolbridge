/**
 * Ollama /api/version Handler
 *
 * Returns a synthetic version response when backend is not Ollama.
 * Prevents errors when clients check the version endpoint.
 */

import { logger } from '../logging/index.js';

import type { Request, Response } from 'express';

/**
 * Handler for /api/version endpoint
 * Returns synthetic version when backend doesn't support this endpoint
 */
export default async function ollamaVersionHandler(_req: Request, res: Response): Promise<void> {
  logger.debug(`[OLLAMA VERSION] Returning synthetic version (backend doesn't support /api/version)`);

  res.status(200).json({
    version: "0.12.6",
  });
}
