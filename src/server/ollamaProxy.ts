/**
 * Ollama API Proxy
 * Proxies Ollama-specific endpoints to the backend Ollama server
 *
 * Routing logic:
 * - If backend mode is Ollama: proxies to BACKEND_LLM_BASE_URL (primary backend)
 * - If backend mode is OpenAI: proxies to OLLAMA_BASE_URL (separate Ollama instance for model management)
 */

import { createProxyMiddleware } from "http-proxy-middleware";

import { OLLAMA_EFFECTIVE_BACKEND_URL } from "../config.js";
import { logger } from "../logging/index.js";
import { logRequestDetails } from "../utils/http/proxyLogging.js";
import {
  buildProxyRequestInfo,
  collectBackendHeaders,
  getOriginalUrl,
  type ProxyResponse,
} from "../utils/http/proxyUtils.js";

import type { Request } from "express";
import type { ClientRequest, IncomingMessage, ServerResponse } from "http";

const ollamaProxyOptions = {
  target: OLLAMA_EFFECTIVE_BACKEND_URL,
  changeOrigin: true,

  // Don't rewrite paths - Ollama uses /api/* directly
  pathRewrite: (path: string, req: IncomingMessage): string => {
    const original = getOriginalUrl(req, path);
    logger.debug(`\n[OLLAMA PROXY] Proxying: ${original} -> ${OLLAMA_EFFECTIVE_BACKEND_URL}${path}`);
    return path;
  },

  on: {
    proxyReq: (proxyReq: ClientRequest, req: IncomingMessage, _res: ServerResponse): void => {
      const expressReq = req as Request;
      // Note: req.body is undefined for proxied routes (body not parsed, forwarded raw)
      logRequestDetails(
        "OLLAMA CLIENT REQUEST",
        {
          method: expressReq.method,
          headers: expressReq.headers,
          body: undefined, // Body forwarded raw by proxy
          ip: expressReq.ip,
          originalUrl: expressReq.originalUrl,
          path: expressReq.path,
        },
        expressReq.headers,
        undefined, // Body forwarded raw by proxy
      );

      // Forward authorization header if present
      const clientAuthHeader = expressReq.headers["authorization"];
      if (clientAuthHeader !== undefined) {
        proxyReq.setHeader("authorization", clientAuthHeader);
      }

      // Set content-type for POST requests
      if (expressReq.method === "POST" && expressReq.body !== undefined) {
        proxyReq.setHeader("content-type", "application/json");
      }

      const backendUrl = `${OLLAMA_EFFECTIVE_BACKEND_URL}${proxyReq.path}`;
      const actualBackendHeaders = collectBackendHeaders(proxyReq);
      const proxyRequestInfo = buildProxyRequestInfo(expressReq, backendUrl, undefined);
      logRequestDetails("OLLAMA PROXY REQUEST", proxyRequestInfo, actualBackendHeaders, undefined);
    },

    proxyRes: (proxyRes: ProxyResponse, req: IncomingMessage, res: ServerResponse): void => {
      const expressReq = req as Request;
      const contentType = proxyRes.headers["content-type"];
      logger.debug(
        `[OLLAMA PROXY RESPONSE] Status: ${proxyRes.statusCode} (${contentType ?? "N/A"}) for ${expressReq.method} ${expressReq.originalUrl}`,
      );
      logger.debug(`[OLLAMA PROXY RESPONSE] Headers received from backend:`);
      logger.debug(JSON.stringify(proxyRes.headers, null, 2));

      // Preserve streaming for endpoints that support it
      if (typeof contentType === "string" &&
          (contentType.includes("application/x-ndjson") || contentType.includes("text/event-stream"))) {
        res.setHeader("Content-Type", contentType);
        res.setHeader("Transfer-Encoding", "chunked");
      }

      // Note: Do not consume the proxyRes stream here as it breaks passthrough
      // The proxy middleware handles forwarding the response to the client
    },

    error: (err: Error & { code?: string }, req: IncomingMessage, res: ServerResponse): void => {
      const expressReq = req as Request;
      logger.error(`[OLLAMA PROXY] Error proxying ${expressReq.originalUrl}:`, err);

      if (!res.headersSent) {
        if (err.code === "ECONNREFUSED") {
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            error: "Service Unavailable",
            message: `Cannot connect to Ollama backend at ${OLLAMA_EFFECTIVE_BACKEND_URL}. Ensure Ollama is running.`,
          }));
        } else {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            error: "Bad Gateway",
            message: `Ollama Proxy Error: ${err.message}`,
          }));
        }
      } else if (!res.writableEnded) {
        res.end();
      }
    },
  },
};

const ollamaProxy = createProxyMiddleware(ollamaProxyOptions as Parameters<typeof createProxyMiddleware>[0]);

export default ollamaProxy;
