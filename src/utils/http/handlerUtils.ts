/**
 * Handler Utilities - SSOT for shared request handler functionality
 *
 * Centralizes common logic used across handlers:
 * - Auth header extraction
 * - Debug logging
 * - Success response sending
 */

import { logger } from '../../logging/index.js';
import { configService } from '../../services/index.js';

import type { Request, Response } from 'express';

/**
 * Extract authorization header from request
 * Returns string if present, undefined otherwise
 */
export function extractAuthHeader(req: Request): string | undefined {
  return typeof req.headers.authorization === 'string'
    ? req.headers.authorization
    : undefined;
}

/**
 * Log response payload if debug mode is enabled
 */
export function logDebugResponse(context: string, response: unknown): void {
  if (configService.isDebugMode()) {
    logger.debug(`[${context}] Response payload:`, JSON.stringify(response, null, 2));
  }
}

/**
 * Send JSON success response with optional debug logging
 */
export function sendSuccessJSON(
  res: Response,
  data: unknown,
  debugContext?: string
): void {
  if (debugContext) {
    logDebugResponse(debugContext, data);
  }
  res.status(200).json(data);
}

/**
 * Get backend mode and auth header - common pattern across handlers
 */
export function getBackendContext(req: Request): {
  backendMode: 'ollama' | 'openai';
  authHeader: string | undefined;
} {
  return {
    backendMode: configService.getBackendMode(),
    authHeader: extractAuthHeader(req),
  };
}
