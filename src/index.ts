
import os from "os";

import chalk from "chalk";
import express, { type Request, type Response } from "express";
import stringWidth from "string-width";

import {
  BACKEND_LLM_BASE_URL,
  BACKEND_MODE,
  CHAT_COMPLETIONS_FULL_URL,
  PROXY_HOST,
  PROXY_PORT,
  SERVING_MODE,
  OLLAMA_EFFECTIVE_BACKEND_URL,
  IS_OLLAMA_MODE,
  validateConfig,
} from "./config.js";
import { OLLAMA_ENDPOINTS, OPENAI_ENDPOINTS } from "./constants/endpoints.js";
import chatCompletionsHandler from "./handlers/chatHandler.js";
import ollamaGenerateHandler from "./handlers/ollamaGenerateHandler.js";
import ollamaShowHandler from "./handlers/ollamaShowHandler.js";
import ollamaTagsHandler from "./handlers/ollamaTagsHandler.js";
import ollamaVersionHandler from "./handlers/ollamaVersionHandler.js";
import openaiModelInfoHandler from "./handlers/openaiModelInfoHandler.js";
import openaiModelsHandler from "./handlers/openaiModelsHandler.js";
import { logger } from "./logging/index.js";
import genericProxy from "./server/genericProxy.js";
import ollamaProxy from "./server/ollamaProxy.js";
import { modelService } from "./services/index.js";

// Import types
import type { Server } from "http";
import type { AddressInfo } from "net";

validateConfig();

const app = express();

app.get("/", (_req: Request, res: Response) => {
  res.json({
    message: "OpenAI Tool Proxy Server is running.",
    status: "OK",
    chat_endpoint: OPENAI_ENDPOINTS.CHAT_COMPLETIONS,
    generic_proxy_base: "/v1",
    target_backend: BACKEND_LLM_BASE_URL,
    target_chat_endpoint: CHAT_COMPLETIONS_FULL_URL,
  });
});

// ============================================================================
// CHAT COMPLETIONS ENDPOINTS (with translation support)
// ============================================================================

// OpenAI-compatible chat completions endpoint
app.post(OPENAI_ENDPOINTS.CHAT_COMPLETIONS, express.json({ limit: "50mb" }), chatCompletionsHandler);

// Ollama native chat endpoint (uses same handler for translation features)
app.post(OLLAMA_ENDPOINTS.CHAT, express.json({ limit: "50mb" }), chatCompletionsHandler);

// Ollama legacy generate endpoint (uses translation engine for all backends)
app.post(OLLAMA_ENDPOINTS.GENERATE, express.json({ limit: "50mb" }), ollamaGenerateHandler);

// ============================================================================
// OPENAI MODEL ENDPOINTS (with translation support)
// ============================================================================

app.get(OPENAI_ENDPOINTS.MODELS, openaiModelsHandler);
app.get(`${OPENAI_ENDPOINTS.MODELS}/:model`, openaiModelInfoHandler);

// ============================================================================
// OLLAMA API ENDPOINTS (with cross-backend translation)
// ============================================================================
//
// Two categories of Ollama endpoints:
//
// 1. TRANSLATION-CAPABLE (enabled when serving=ollama, work with any backend):
//    - /api/tags: Model listing with automatic format translation
//    - /api/show: Model info with automatic format translation
//
// 2. PROXY-ONLY (enabled ONLY when backend IS Ollama):
//    - /api/version, /api/create, /api/pull, etc.
//    - These require actual Ollama backend for management operations
//
// Supported Scenarios:
// - serving=ollama, backend=ollama → All endpoints work (direct proxy)
// - serving=ollama, backend=openai → Only /api/tags + /api/show work (translated)
// - serving=openai, backend=* → Use /v1/* endpoints instead
//

// Translation-capable endpoints (work with any backend)
if (SERVING_MODE === "ollama") {
  app.get(OLLAMA_ENDPOINTS.TAGS, ollamaTagsHandler);     // Fetches from backend, translates to Ollama format
  app.post(OLLAMA_ENDPOINTS.SHOW, express.json({ limit: "50mb" }), ollamaShowHandler);  // Fetches from backend, translates to Ollama format

  // Version endpoint - returns synthetic version when backend is not Ollama
  if (!IS_OLLAMA_MODE) {
    app.get(OLLAMA_ENDPOINTS.VERSION, ollamaVersionHandler);  // Synthetic version for non-Ollama backends
  }

  logger.info(`[SERVER] Ollama translation endpoints ENABLED: ${OLLAMA_ENDPOINTS.TAGS}, ${OLLAMA_ENDPOINTS.SHOW}, ${OLLAMA_ENDPOINTS.VERSION}`);
  logger.info(`[SERVER]   Translation: ${BACKEND_MODE.toUpperCase()} backend → Ollama format`);
}

// Proxy-only endpoints (require actual Ollama backend)
if (IS_OLLAMA_MODE) {
  // Model management (requires Ollama backend)
  app.post(OLLAMA_ENDPOINTS.CREATE, ollamaProxy);        // Create model
  app.post(OLLAMA_ENDPOINTS.COPY, ollamaProxy);          // Copy model
  app.delete(OLLAMA_ENDPOINTS.DELETE, ollamaProxy);      // Delete model
  app.post(OLLAMA_ENDPOINTS.PULL, ollamaProxy);          // Pull model
  app.post(OLLAMA_ENDPOINTS.PUSH, ollamaProxy);          // Push model

  // Embedding endpoints
  app.post("/api/embed", ollamaProxy);         // Generate embeddings
  app.post("/api/embeddings", ollamaProxy);    // Generate embeddings (legacy)

  // System endpoints
  app.get("/api/ps", ollamaProxy);             // List running models
  app.get(OLLAMA_ENDPOINTS.VERSION, ollamaProxy);        // Get version

  // Blob endpoints
  app.head("/api/blobs/:digest", ollamaProxy);                 // Check blob exists
  app.post("/api/blobs/:digest", express.raw({ type: "application/octet-stream", limit: "10gb" }), ollamaProxy);

  logger.info(`[SERVER] Ollama proxy endpoints ENABLED (backend is Ollama)`);
  logger.info(`[SERVER]   Proxying management operations to: ${OLLAMA_EFFECTIVE_BACKEND_URL}`);
}

// Summary log
if (SERVING_MODE === "ollama" && !IS_OLLAMA_MODE) {
  logger.info(`[SERVER] Note: Ollama management endpoints (/api/create, /api/pull, /api/push) are DISABLED`);
  logger.info(`[SERVER]       These require an actual Ollama backend for model management.`);
  logger.info(`[SERVER]       Translation-capable endpoints (/api/tags, /api/show, /api/version) are ENABLED.`);
} else if (SERVING_MODE !== "ollama") {
  logger.info(`[SERVER] Ollama endpoints DISABLED (serving mode is ${SERVING_MODE.toUpperCase()})`);
}

// ============================================================================
// OPENAI API PROXY (for other /v1/* endpoints)
// ============================================================================

// Generic proxy for all other /v1/* endpoints (models, embeddings, etc.)
app.use("/v1", genericProxy);

// 404 handler - Express 5 compatible
app.use((_req: Request, res: Response) => {
  logger.warn("[PROXY] 404 Not Found:", _req.originalUrl);
  res.status(404).json({
    error: "Endpoint not found",
    message: "This route is not handled by the proxy server.",
  });
});

async function warmModelCaches(): Promise<void> {
  try {
    await modelService.preloadModelCache();
    logger.info("[SERVER] Model cache warmed successfully");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[SERVER] Failed to warm model cache: ${message}`);
    if (error) {
      logger.debug("[SERVER] Model cache warm failure details", error);
    }
  }
}

function getNetworkIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const networkInterface = interfaces[name];
    if (networkInterface) {
      for (const net of networkInterface) {
        if (net.family === "IPv4" && !net.internal) {
          return net.address;
        }
      }
    }
  }
  return "localhost";
}

const cacheWarmPromise = warmModelCaches();

void cacheWarmPromise.finally(() => {
  const server: Server = app.listen(PROXY_PORT, PROXY_HOST, () => {
    const addressInfo = server.address() as AddressInfo | null;

    // In some environments, addressInfo may briefly be null even though the
    // server is bound correctly. Treat that as a non-fatal condition and fall
    // back to the configured host/port instead of exiting.
    const actualPort = addressInfo?.port ?? Number(PROXY_PORT);
    const host = addressInfo?.address ?? PROXY_HOST;

    const BOX_WIDTH = 51;

    const BOX_CHAR = {
      topLeft: "┌",
      topRight: "┐",
      bottomLeft: "└",
      bottomRight: "┘",
      horizontal: "─",
      vertical: "│",
      leftT: "├",
      rightT: "┤",
      topT: "┬",
      bottomT: "┴",
      cross: "┼",
    };

    function createAlignedLine(text: string): string {
      const plainText = text.replace(/\x1b\[[0-9;]*m/g, "");
      const textWidth = stringWidth(plainText);
      const padding = Math.max(0, BOX_WIDTH - 2 - textWidth);
      const leftPadding = Math.floor(padding / 2);
      const rightPadding = padding - leftPadding;

      return (
        chalk.bold.blue(BOX_CHAR.vertical) +
        " ".repeat(leftPadding) +
        text +
        " ".repeat(rightPadding) +
        chalk.bold.blue(BOX_CHAR.vertical)
      );
    }

    const topBorder = chalk.bold.blue(
      BOX_CHAR.topLeft +
      BOX_CHAR.horizontal.repeat(BOX_WIDTH - 2) +
      BOX_CHAR.topRight
    );

    const middleSeparator = chalk.bold.blue(
      BOX_CHAR.leftT + BOX_CHAR.horizontal.repeat(BOX_WIDTH - 2) + BOX_CHAR.rightT
    );

    const bottomBorder = chalk.bold.blue(
      BOX_CHAR.bottomLeft +
      BOX_CHAR.horizontal.repeat(BOX_WIDTH - 2) +
      BOX_CHAR.bottomRight
    );

    // Use logger to avoid direct console usage and satisfy ESLint no-console
    logger.info("");
    logger.info(topBorder);
    logger.info(
      createAlignedLine(chalk.bold.green("🚀 ToolBridge") + chalk.dim(" - LLM Function Calling Proxy"))
    );
    logger.info(createAlignedLine(chalk.dim(`   Running on port: ${actualPort}`)));
    logger.info(createAlignedLine(chalk.dim(`   Binding address: ${host}`)));

    logger.info(
      createAlignedLine(
        chalk.yellow("➤ ") + chalk.cyan(`Serving mode:  `) + chalk.green(`${SERVING_MODE.toUpperCase()}`)
      )
    );
    logger.info(
      createAlignedLine(
        chalk.yellow("➤ ") + chalk.cyan(`Backend mode:  `) + chalk.green(`${BACKEND_MODE.toUpperCase()}`)
      )
    );
    logger.info(
      createAlignedLine(
        chalk.yellow("➤ ") + chalk.cyan(`Backend URL:   `) + chalk.green(`${BACKEND_LLM_BASE_URL}`)
      )
    );

    logger.info(middleSeparator);
    logger.info(createAlignedLine(chalk.magenta("Available Endpoints:")));

    // Show OpenAI endpoint (always available)
    logger.info(createAlignedLine(chalk.cyan(`  • ${OPENAI_ENDPOINTS.CHAT_COMPLETIONS} (OpenAI)`)));
    logger.info(createAlignedLine(chalk.cyan(`  • ${OPENAI_ENDPOINTS.MODELS} (OpenAI models API)`)));

    // Show Ollama endpoints based on configuration
    if (SERVING_MODE === "ollama") {
      logger.info(createAlignedLine(chalk.cyan(`  • ${OLLAMA_ENDPOINTS.CHAT} (Ollama w/ translation)`)));
      logger.info(createAlignedLine(chalk.cyan(`  • ${OLLAMA_ENDPOINTS.GENERATE} (Ollama w/ translation)`)));
      logger.info(createAlignedLine(chalk.cyan(`  • ${OLLAMA_ENDPOINTS.TAGS} (Ollama w/ translation)`)));
      logger.info(createAlignedLine(chalk.cyan(`  • ${OLLAMA_ENDPOINTS.SHOW} (Ollama w/ translation)`)));
      logger.info(createAlignedLine(chalk.cyan(`  • ${OLLAMA_ENDPOINTS.VERSION} (Ollama)`)));

      if (IS_OLLAMA_MODE) {
        logger.info(createAlignedLine(chalk.cyan(`  • /api/* (Ollama management)`)));
      }
    }
    logger.info(middleSeparator);
    logger.info(createAlignedLine(chalk.magenta("Access URLs:")));
    logger.info(createAlignedLine(chalk.cyan(`  Local:   http://localhost:${actualPort}/`)));
    logger.info(createAlignedLine(chalk.cyan(`  Network: http://${getNetworkIP()}:${actualPort}/`)));
    logger.info(bottomBorder + "\n");
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.syscall !== "listen") {
      throw error;
    }

    const bind = typeof PROXY_PORT === "string"
      ? "Pipe " + PROXY_PORT
      : "Port " + PROXY_PORT;

    switch (error.code) {
      case "EACCES":
        logger.error(`\n[ERROR] ${bind} requires elevated privileges.`);
        process.exit(1);
        break;
      case "EADDRINUSE":
        logger.error(`\n[ERROR] ${bind} is already in use.`);
        process.exit(1);
        break;
      default:
        throw error;
    }
  });
});