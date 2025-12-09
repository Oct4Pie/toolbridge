import { createProxyMiddleware } from "http-proxy-middleware";

import { BACKEND_LLM_BASE_URL } from "../config.js";
import { logger } from "../logging/index.js";
import { buildBackendHeaders } from "../utils/http/index.js";
import { logRequestDetails } from "../utils/http/proxyLogging.js";
import {
  buildProxyRequestInfo,
  collectBackendHeaders,
  getOriginalUrl,
  type ProxyResponse,
} from "../utils/http/proxyUtils.js";

import type { Request } from "express";
import type { ClientRequest, IncomingMessage, ServerResponse } from "http";

const proxyOptions = {
  target: BACKEND_LLM_BASE_URL,
  changeOrigin: true,

  pathRewrite: (path: string, req: IncomingMessage): string => {
    // Path already stripped of /v1 by Express, pass through as-is
    // BACKEND_LLM_BASE_URL already includes /api/v1, so we just need the endpoint path
    const original = getOriginalUrl(req, path);
    logger.debug(`\n[PROXY] Passing through path: ${original} -> ${path}`);
    return path;
  },

  on: {
    proxyReq: (proxyReq: ClientRequest, req: IncomingMessage, _res: ServerResponse): void => {
      const expressReq = req as Request;
      logRequestDetails(
        "CLIENT REQUEST",
        {
          method: expressReq.method,
          headers: expressReq.headers,
          body: expressReq.body,
          ip: expressReq.ip,
          originalUrl: expressReq.originalUrl,
          path: expressReq.path,
        },
        expressReq.headers,
        expressReq.body,
      );

      const clientAuthHeader = expressReq.headers["authorization"];
      const backendHeaders = buildBackendHeaders(clientAuthHeader, expressReq.headers, "proxy");

      Object.keys(backendHeaders).forEach((key) => {
        const value = backendHeaders[key];
        if (value !== undefined) {
          proxyReq.setHeader(key, value);
        }
      });

      const backendUrl = `${BACKEND_LLM_BASE_URL}${proxyReq.path}`;
      const actualBackendHeaders = collectBackendHeaders(proxyReq);
      const proxyRequestInfo = buildProxyRequestInfo(expressReq, backendUrl, expressReq.body);
      logRequestDetails("PROXY REQUEST", proxyRequestInfo, actualBackendHeaders, expressReq.body);
    },

    proxyRes: (proxyRes: ProxyResponse, req: IncomingMessage, res: ServerResponse): void => {
      const expressReq = req as Request;
      const contentType = proxyRes.headers["content-type"];
      logger.debug(
        `[PROXY RESPONSE] Status: ${proxyRes.statusCode} (${contentType ?? "N/A"}) for ${expressReq.method} ${expressReq.originalUrl}`,
      );
      logger.debug(`[PROXY RESPONSE] Headers received from backend:`);
      logger.debug(JSON.stringify(proxyRes.headers, null, 2));

      if (typeof contentType === "string" && contentType.includes("text/event-stream")) {
        res.setHeader("Content-Type", "text/event-stream");
      }

      // Note: Do not consume the proxyRes stream here as it breaks passthrough
      // The proxy middleware handles forwarding the response to the client
    },

    error: (err: Error & { code?: string }, _req: IncomingMessage, res: ServerResponse): void => {
      logger.error("Proxy error:", err);

      if (!res.headersSent) {
        if (err.code === "ECONNREFUSED") {
          res.statusCode = 503;
          res.end(`Service Unavailable: Cannot connect to backend at ${BACKEND_LLM_BASE_URL}`);
        } else {
          res.statusCode = 502;
          res.end(`Proxy Error: ${err.message}`);
        }
      } else if (!res.writableEnded) {
        res.end();
      }
    },
  },
};

const genericProxy = createProxyMiddleware(proxyOptions as Parameters<typeof createProxyMiddleware>[0]);

export default genericProxy;
