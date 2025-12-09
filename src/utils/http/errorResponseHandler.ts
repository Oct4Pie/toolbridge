/**
 * Error Response Handler - SSOT for HTTP Error Handling
 *
 * Centralizes error handling logic across all handlers to eliminate duplication.
 *
 * SSOT Compliance:
 * - All HTTP error mapping logic lives here
 * - All BackendError logging lives here
 * - All error response formatting lives here
 */

import type { BackendError } from "../../types/toolbridge.js";
import type { Response } from "express";

const logger = console;

/**
 * Error severity levels for different error types
 */
export enum ErrorSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

/**
 * HTTP error response format
 */
export interface HTTPErrorResponse {
  error: string;
  message: string;
  statusCode: number;
}

/**
 * Maps common error patterns to HTTP status codes and error types
 * SSOT for error-to-status-code mapping
 */
export function detectHTTPError(errorMessage: string): HTTPErrorResponse {
  const msg = errorMessage.toLowerCase();

  // Connection errors → 503 Service Unavailable
  if (msg.includes('econnrefused') || msg.includes('enotfound')) {
    return {
      error: 'Service Unavailable',
      message: `Cannot connect to backend: ${errorMessage}`,
      statusCode: 503,
    };
  }

  // Network errors → 502 Bad Gateway
  if (msg.includes('failed to fetch') || msg.includes('network error')) {
    return {
      error: 'Bad Gateway',
      message: errorMessage,
      statusCode: 502,
    };
  }

  // Authorization errors → 401 Unauthorized
  if (msg.includes('401') || msg.includes('unauthorized')) {
    return {
      error: 'Unauthorized',
      message: errorMessage,
      statusCode: 401,
    };
  }

  // Rate limiting → 429 Too Many Requests
  if (msg.includes('429') || msg.includes('rate limit')) {
    return {
      error: 'Rate Limited',
      message: errorMessage,
      statusCode: 429,
    };
  }

  // Not found errors → 404
  if (msg.includes('404') || /not\s+found/.test(msg)) {
    return {
      error: 'Not Found',
      message: errorMessage,
      statusCode: 404,
    };
  }

  // Default → 500 Internal Server Error
  return {
    error: 'Internal Server Error',
    message: errorMessage,
    statusCode: 500,
  };
}

/**
 * Extracts error message from unknown error type
 * SSOT for error message extraction
 * 
 * Handles various error formats:
 * - Error instances (message property)
 * - String errors
 * - Objects with message/error properties
 * - null/undefined
 * - Prevents '[object Object]' output
 */
export function extractErrorMessage(error: unknown): string {
  // Handle null/undefined early
  if (error === null || error === undefined) {
    return 'Unknown error (empty response)';
  }

  // Standard Error instance
  if (error instanceof Error) {
    return error.message || 'Unknown error';
  }

  // String error
  if (typeof error === 'string') {
    return error.trim() || 'Unknown error (empty string)';
  }

  // Object with message or error property
  if (typeof error === 'object') {
    const errorObj = error as Record<string, unknown>;
    
    // Check for 'message' property
    const messageVal = errorObj['message'];
    if (typeof messageVal === 'string' && messageVal.trim()) {
      return messageVal.trim();
    }
    
    // Check for 'error' property (common in API responses)
    const errorProp = errorObj['error'];
    if (errorProp !== undefined) {
      if (typeof errorProp === 'string' && errorProp.trim()) {
        return errorProp.trim();
      }
      // Nested error object (e.g., { error: { message: '...' } })
      if (typeof errorProp === 'object' && errorProp !== null) {
        const nestedError = errorProp as Record<string, unknown>;
        const nestedMessage = nestedError['message'];
        if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
          return nestedMessage.trim();
        }
      }
    }
    
    // Try JSON.stringify for objects, but avoid '[object Object]'
    try {
      const stringified = JSON.stringify(error);
      if (stringified && stringified !== '{}' && stringified !== '[]') {
        return `Error details: ${stringified}`;
      }
    } catch {
      // JSON.stringify failed, fall through to default
    }
  }

  return 'Unknown error';
}

/**
 * Logs detailed BackendError information
 * SSOT for BackendError logging
 */
export function logBackendError(context: string, error: BackendError): void {
  logger.error(`\n--- ${context} ---`);
  logger.error('Error Message:', error.message);

  if (error.stack) {
    logger.error('Stack Trace:', error.stack);
  }

  if (error.response) {
    logger.error('Backend Response Status:', error.response.status);
    logger.error('Backend Response Data:', error.response.data);
  } else if (error.request) {
    logger.error('Backend Request Data:', error.request);
  }
}

/**
 * Sends an HTTP error response (for non-streaming handlers)
 * SSOT for HTTP error response sending
 *
 * @param res - Express response object
 * @param error - Unknown error object
 * @param context - Error context for logging (e.g., "OPENAI MODELS")
 */
export function sendHTTPError(res: Response, error: unknown, context: string): void {
  logger.error(`[${context}] Error:`, error);

  const errorMessage = extractErrorMessage(error);
  const httpError = detectHTTPError(errorMessage);

  res.status(httpError.statusCode).json({
    error: httpError.error,
    message: httpError.message,
  });
}

/**
 * Sends a validation error response (400 Bad Request)
 * SSOT for validation error handling
 *
 * @param res - Express response object
 * @param message - Validation error message
 * @param context - Optional error context for logging
 */
export function sendValidationError(res: Response, message: string, context?: string): void {
  if (context) {
    logger.error(`[${context}] Validation error: ${message}`);
  }

  res.status(400).json({
    error: 'Bad Request',
    message,
  });
}

/**
 * Handles BackendError for streaming handlers
 * SSOT for streaming error handling
 *
 * Checks response state and either:
 * - Sends error JSON (if headers not sent)
 * - Closes stream gracefully (if headers sent but stream open)
 * - Logs inability to send error (if stream already closed)
 *
 * @param res - Express response object
 * @param error - Backend error
 * @param context - Error context for logging
 * @param customErrorMessage - Optional custom error message
 */
export function handleStreamingBackendError(
  res: Response,
  error: unknown,
  context: string,
  customErrorMessage?: string,
): void {
  const backendError = error as BackendError;

  logBackendError(context, backendError);

  if (!res.headersSent) {
    // Headers not sent yet - can send proper error response
    const statusCode = backendError.status ?? 500;
    
    // Extract a meaningful error message, avoiding empty or unhelpful messages
    let errorMessage = extractErrorMessage(backendError);
    
    // If we still have an unhelpful message, provide context
    if (!errorMessage || errorMessage === 'Unknown error' || errorMessage === 'Unknown error (empty response)') {
      errorMessage = `Backend request failed (HTTP ${statusCode})`;
    }
    
    // Build consistent error message format: always include status code
    const message = customErrorMessage ?? `[HTTP ${statusCode}] ${errorMessage}`;

    res.status(statusCode).json({
      error: message,
      statusCode: statusCode,
    });
  } else if (!res.writableEnded) {
    // Headers sent but stream still open - close gracefully
    logger.error('[ERROR] Headers already sent, attempting to end stream.');
    res.end();
  } else {
    // Stream already closed - log only
    logger.error('[ERROR] Headers sent and stream ended. Cannot send error response.');
  }
}

/**
 * Format-specific error payload generators
 */

/**
 * Creates OpenAI-format error response
 */
export function createOpenAIErrorPayload(message: string, type: string = 'proxy_error'): Record<string, unknown> {
  return {
    object: 'error',
    message,
    type,
    code: null,
    param: null,
  };
}

/**
 * Creates Ollama-format error response
 */
export function createOllamaErrorPayload(message: string): Record<string, unknown> {
  return {
    error: message,
    done: true,
  };
}
