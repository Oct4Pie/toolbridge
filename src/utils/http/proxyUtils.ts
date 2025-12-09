/**
 * Proxy Utilities - SSOT for shared proxy middleware functionality
 *
 * Centralizes common logic used by both genericProxy and ollamaProxy:
 * - ProxyResponse type definition
 * - Backend headers collection
 * - ProxyRequest info construction
 */

import type { ProxyRequest } from "./proxyLogging.js";
import type { Request } from "express";
import type { ClientRequest, IncomingMessage } from "http";

/**
 * Extended IncomingMessage with statusCode for proxy responses
 */
export interface ProxyResponse extends IncomingMessage {
  statusCode?: number;
}

/**
 * Extract original URL from incoming message
 */
export function getOriginalUrl(req: IncomingMessage, fallback: string): string {
  const reqWithUrl = req as IncomingMessage & { originalUrl?: string; url?: string };
  return reqWithUrl.originalUrl ?? reqWithUrl.url ?? fallback;
}

/**
 * Collect all headers from proxy request as a record
 * Converts number values to strings for consistency
 */
export function collectBackendHeaders(
  proxyReq: ClientRequest
): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {};

  for (const name of proxyReq.getHeaderNames()) {
    const value = proxyReq.getHeader(name);
    headers[name] = typeof value === "number" ? String(value) : value;
  }

  return headers;
}

/**
 * Build ProxyRequest info object for logging
 */
export function buildProxyRequestInfo(
  expressReq: Request,
  backendUrl: string,
  body: unknown = undefined
): ProxyRequest {
  return {
    method: expressReq.method,
    headers: expressReq.headers,
    body,
    ip: expressReq.ip,
    originalUrl: backendUrl,
    path: backendUrl,
  };
}
