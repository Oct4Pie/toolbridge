#!/usr/bin/env node

import "dotenv/config";
import express from "express";

import { logger } from "../logging/index.js";
import { translationService } from "../services/translationService.js";

import type { LLMProvider } from "../translation/types/index.js";
import type { OpenAITool } from "../types/index.js";
import type { Request, Response } from "express";

const DEFAULT_PORT = 4004;
const port = (() => {
  const envValue = process.env["TRANSLATION_DEMO_PORT"];
  if (!envValue) {
    return DEFAULT_PORT;
  }
  const parsed = Number(envValue);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  logger.warn(
    `Invalid TRANSLATION_DEMO_PORT value (${envValue}). Falling back to default ${DEFAULT_PORT}.`,
  );
  return DEFAULT_PORT;
})();

const app = express();
app.use(express.json({ limit: "25mb" }));

function extractToolNames(tools: OpenAITool[] | undefined): string[] {
  if (!tools || tools.length === 0) {
    return [];
  }

  return tools
    .map((tool) => {
      if (tool.type !== "function") {
        return null;
      }
      return tool.function.name ?? null;
    })
    .filter((name): name is string => Boolean(name && name.trim() !== ""));
}

interface TranslateRequestBody {
  from?: LLMProvider;
  to?: LLMProvider;
  request?: unknown;
  tools?: OpenAITool[];
}

interface TranslateResponseBody {
  from?: LLMProvider;
  to?: LLMProvider;
  response?: unknown;
  tools?: OpenAITool[];
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Translation Demo Server",
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (_req, res) => {
  res.json({
    name: "ToolBridge Translation Demo Server",
    version: "1.0.0",
    description: "Demonstrates the translation service without running the full proxy stack.",
    endpoints: {
      translate: {
        method: "POST",
        path: "/translate",
        body: {
          from: "LLM provider for the incoming payload",
          to: "Target LLM provider",
          request: "Provider-specific request payload",
          tools: "Optional OpenAI tool definitions",
        },
      },
      translateResponse: {
        method: "POST",
        path: "/translate-response",
        body: {
          from: "LLM provider of the response payload",
          to: "Target LLM provider",
          response: "Provider-specific response payload",
          tools: "Optional OpenAI tool definitions",
        },
      },
      health: {
        method: "GET",
        path: "/health",
      },
    },
  });
});

app.post("/translate", async (req: Request<{}, unknown, TranslateRequestBody>, res: Response) => {
  const { from, to, request, tools } = req.body;

  if (!from || !to || typeof request === "undefined") {
    res.status(400).json({
      success: false,
      error: "Body must include 'from', 'to', and 'request' fields.",
    });
    return;
  }

  const toolNames = extractToolNames(tools);

  try {
    const translated = await translationService.translateRequest(request, from, to, toolNames);
    res.json({ success: true, data: translated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown translation error";
    logger.error("[translation-demo] Request translation failed", error);
    res.status(500).json({ success: false, error: message });
  }
});

app.post(
  "/translate-response",
  async (req: Request<{}, unknown, TranslateResponseBody>, res: Response) => {
    const { from, to, response, tools } = req.body;

    if (!from || !to || typeof response === "undefined") {
      res.status(400).json({
        success: false,
        error: "Body must include 'from', 'to', and 'response' fields.",
      });
      return;
    }

    const toolNames = extractToolNames(tools);

    try {
      const translated = await translationService.translateResponse(response, from, to, toolNames);
      res.json({ success: true, data: translated });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown translation error";
      logger.error("[translation-demo] Response translation failed", error);
      res.status(500).json({ success: false, error: message });
    }
  },
);

app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  logger.error("[translation-demo] Unhandled error", error);
  res.status(500).json({ success: false, error: "Internal server error" });
});

app.listen(port, () => {
  logger.info(`🌉 Translation demo server listening on http://localhost:${port}`);
  logger.info(`📚 Docs: http://localhost:${port}/`);
});
