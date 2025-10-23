import logger from './logger.js';

import type { Response } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import type { Dispatcher } from 'undici';


// Copy headers from upstream response to client response, excluding specified headers
export function copyHeadersExcept(
  srcHeaders: IncomingHttpHeaders | Record<string, string | string[]>,
  res: Response,
  exclude: string[] = []
): void {
  const normalizedExclude = exclude.map(h => h.toLowerCase());
  
  for (const [key, value] of Object.entries(srcHeaders)) {
    if (normalizedExclude.includes(key.toLowerCase()) || !value) {
      continue;
    }
    
    // Handle both string and string array values
    if (Array.isArray(value)) {
      res.setHeader(key, value.join(', '));
    } else {
      res.setHeader(key, value);
    }
  }
}

// Pipe Server-Sent Events from upstream response to client
export async function pipeSSE(up: Dispatcher.ResponseData, res: Response): Promise<void> {
  res.status(up.statusCode);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  copyHeadersExcept(up.headers, res, ['content-length', 'content-encoding', 'transfer-encoding']);

  if (!up.body) {
    logger.error('No body in upstream SSE response');
    res.end();
    return;
  }

  try {
    // Pipe the readable stream directly to the response
    up.body.pipe(res);
    
    up.body.on('end', () => {
      logger.debug('SSE stream ended');
    });

    up.body.on('error', (error) => {
      logger.error('Error in SSE stream:', error);
      res.end();
    });

  } catch (error) {
    logger.error('Error piping SSE stream:', error);
    res.end();
  }
}

// Send error response in consistent format
export function sendError(res: Response, statusCode: number, message: string): void {
  res.status(statusCode).json({
    error: {
      message,
      type: 'proxy_error',
      code: statusCode.toString()
    }
  });
}
