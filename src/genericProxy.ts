import { createProxyMiddleware } from "http-proxy-middleware";


import { BACKEND_LLM_BASE_URL } from "./config.js";
import { buildBackendHeaders } from "./utils/headerUtils.js";
import logger from "./utils/logger.js";

import type { Request } from "express";
import type { ClientRequest, IncomingMessage, ServerResponse } from "http";

interface ProxyRequest {
  method: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  ip: string | undefined;
  originalUrl: string | undefined;
  path: string;
}

interface ProxyResponse extends IncomingMessage {
  statusCode?: number;
}

const logRequestDetails = (
  label: string,
  req: ProxyRequest,
  headers: Record<string, string | string[] | undefined>,
  body: unknown = null
): void => {
  logger.debug(`
[${label}] =====================`);
  logger.debug(`[${label}] ${req.method} ${req.originalUrl ?? req.path}`);
  if (req.ip && req.ip !== "") { logger.debug(`[${label}] Client IP: ${req.ip}`); }
  logger.debug(`[${label}] Headers:`, JSON.stringify(headers, null, 2));
  
  if (body && req.method !== "GET" && req.method !== "HEAD") {
    let safeBody: unknown;
    try {
      safeBody = JSON.parse(JSON.stringify(body));
      if (typeof safeBody === 'object' && safeBody !== null && 'api_key' in safeBody) {
        (safeBody as Record<string, unknown>).api_key = "********";
      }
    } catch {
      safeBody = "[Unable to parse or clone body]";
    }
    logger.debug(`[${label}] Body:`, JSON.stringify(safeBody, null, 2));
  }
  logger.debug(`[${label}] =====================
`);
};

const proxyOptions = {
  target: BACKEND_LLM_BASE_URL,
  changeOrigin: true,

  pathRewrite: (path: string, req: IncomingMessage): string => {
    const backendPath = "/v1" + path;
  const reqWithUrl = req as IncomingMessage & { originalUrl?: string; url?: string };
  const original = reqWithUrl.originalUrl ?? reqWithUrl.url ?? path;
    logger.debug(`\n[PROXY] Rewriting path: ${original} -> ${backendPath}`);
    return backendPath;
  },

  on: {
    proxyReq: (proxyReq: ClientRequest, req: IncomingMessage, _res: ServerResponse): void => {
      const expressReq = req as Request;
      logRequestDetails("CLIENT REQUEST", {
        method: expressReq.method,
        headers: expressReq.headers,
        body: expressReq.body,
        ip: expressReq.ip,
        originalUrl: expressReq.originalUrl,
        path: expressReq.path,
      }, expressReq.headers, expressReq.body);

  const clientAuthHeader = expressReq.headers["authorization"];
  const backendHeaders = buildBackendHeaders(clientAuthHeader, expressReq.headers, "proxy");

      Object.keys(backendHeaders).forEach((key) => {
        const value = backendHeaders[key];
        if (value !== undefined) {
          proxyReq.setHeader(key, value);
        }
      });

  const backendUrl = `${BACKEND_LLM_BASE_URL}${proxyReq.path}`;
      const actualBackendHeaders: Record<string, string | string[] | undefined> = {};
      
      for (const name of proxyReq.getHeaderNames()) {
        const value = proxyReq.getHeader(name);
        actualBackendHeaders[name] = typeof value === "number" ? String(value) : value;
      }
      
      const proxyRequestInfo: ProxyRequest = {
        method: expressReq.method,
        headers: expressReq.headers,
        body: expressReq.body,
        ip: expressReq.ip,
        originalUrl: backendUrl,
        path: backendUrl,
      };
      logRequestDetails(
        "PROXY REQUEST",
        proxyRequestInfo,
        actualBackendHeaders,
        expressReq.body,
      );
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
  } else if (expressReq.path === "/models") {
        let responseBody = "";
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);

        proxyRes.on("data", (chunk: Buffer | string) => {
          responseBody += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        });

  res.write = (): boolean => true;

        res.end = (chunk?: unknown): ServerResponse<IncomingMessage> => {
          if (chunk) {
            responseBody += typeof chunk === "string" ? chunk : String(chunk);
          }
          try {
            const parsedBody = JSON.parse(responseBody);
            logger.debug(`[PROXY RESPONSE] Models response body:`);
            logger.debug(JSON.stringify(parsedBody, null, 2));
          } catch {
            logger.debug(
              `[PROXY RESPONSE] Raw models response body (non-JSON):`,
              responseBody,
            );
          }

          originalWrite(responseBody, "utf8");
          originalEnd.call(res, undefined, "utf8", () => {});
          return res;
        };
      }
    },

    error: (err: Error & { code?: string }, _req: IncomingMessage, res: ServerResponse): void => {
      logger.error("Proxy error:", err);
      
      if (!res.headersSent) {
        if (err.code === "ECONNREFUSED") {
          res.statusCode = 503;
          res.end(
            `Service Unavailable: Cannot connect to backend at ${BACKEND_LLM_BASE_URL}`,
          );
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