/**
 * Proxy logging utilities
 * SSOT for request/response logging in proxy middleware
 */

import { logger } from "../../logging/index.js";

interface ProxyRequest {
  method: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  ip: string | undefined;
  originalUrl: string | undefined;
  path: string;
}

/**
 * Log proxy request details with sanitized body
 * Centralizes duplicate logging code from genericProxy and ollamaProxy
 */
export const logRequestDetails = (
  label: string,
  req: ProxyRequest,
  headers: Record<string, string | string[] | undefined>,
  body: unknown = null,
): void => {
  logger.debug(`\n[${label}] =====================`);
  logger.debug(`[${label}] ${req.method} ${req.originalUrl ?? req.path}`);
  if (req.ip && req.ip !== "") {
    logger.debug(`[${label}] Client IP: ${req.ip}`);
  }
  logger.debug(`[${label}] Headers:`, JSON.stringify(headers, null, 2));

  if (body && req.method !== "GET" && req.method !== "HEAD") {
    let safeBody: unknown;
    try {
      safeBody = JSON.parse(JSON.stringify(body));
      if (typeof safeBody === "object" && safeBody !== null && "api_key" in safeBody) {
        (safeBody as Record<string, unknown>)["api_key"] = "********";
      }
    } catch {
      safeBody = "[Unable to parse or clone body]";
    }
    logger.debug(`[${label}] Body:`, JSON.stringify(safeBody, null, 2));
  }
  logger.debug(`[${label}] =====================\n`);
};

export type { ProxyRequest };
