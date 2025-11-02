
import os from "os";

import chalk from "chalk";
import express from "express";
import stringWidth from "string-width";

import {
  BACKEND_LLM_BASE_URL,
  BACKEND_MODE,
  CHAT_COMPLETIONS_FULL_URL,
  IS_OLLAMA_MODE,
  PROXY_HOST,
  PROXY_PORT,
  SERVING_MODE,
  validateConfig,
} from "./config.js";
import chatCompletionsHandler from "./handlers/chatHandler.js";
import ollamaShowHandler from "./handlers/ollamaShowHandler.js";
import ollamaTagsHandler from "./handlers/ollamaTagsHandler.js";
import { logger } from "./logging/index.js";
import genericProxy from "./server/genericProxy.js";
import ollamaProxy from "./server/ollamaProxy.js";

// Import types
import type { Request, Response } from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";

validateConfig();

const app = express();

app.get("/", (_req: Request, res: Response) => {
  res.json({
    message: "OpenAI Tool Proxy Server is running.",
    status: "OK",
    chat_endpoint: "/v1/chat/completions",
    generic_proxy_base: "/v1",
    target_backend: BACKEND_LLM_BASE_URL,
    target_chat_endpoint: CHAT_COMPLETIONS_FULL_URL,
  });
});

// ============================================================================
// CHAT COMPLETIONS ENDPOINTS (with translation support)
// ============================================================================

// OpenAI-compatible chat completions endpoint
app.post("/v1/chat/completions", express.json({ limit: "50mb" }), chatCompletionsHandler);

// Ollama native chat endpoint (uses same handler for translation features)
app.post("/api/chat", express.json({ limit: "50mb" }), chatCompletionsHandler);

// ============================================================================
// OLLAMA API ENDPOINTS (proxied to backend)
// ============================================================================
//
// Enable Ollama endpoints when:
// 1. SERVING_MODE === "ollama" - Clients expect Ollama API format
// 2. IS_OLLAMA_MODE === true - Backend is Ollama (enables model management)
//
if (SERVING_MODE === "ollama" || IS_OLLAMA_MODE) {
  const ollamaBackendUrl = IS_OLLAMA_MODE ? BACKEND_LLM_BASE_URL : "http://localhost:11434";

  // Model management endpoints
  app.get("/api/tags", ollamaTagsHandler);     // List models (modified to advertise tool support)
  app.post("/api/show", express.json({ limit: "50mb" }), ollamaShowHandler);  // Show model info (modified to advertise tool support)
  app.post("/api/create", ollamaProxy);        // Create model
  app.post("/api/copy", ollamaProxy);          // Copy model
  app.delete("/api/delete", ollamaProxy);      // Delete model
  app.post("/api/pull", ollamaProxy);          // Pull model
  app.post("/api/push", ollamaProxy);          // Push model

  // Generation endpoints
  app.post("/api/generate", ollamaProxy);      // Generate completions

  // Embedding endpoints
  app.post("/api/embed", ollamaProxy);         // Generate embeddings
  app.post("/api/embeddings", ollamaProxy);    // Generate embeddings (legacy)

  // System endpoints
  app.get("/api/ps", ollamaProxy);                             // List running models
  app.get("/api/version", ollamaProxy);                        // Get version

  // Blob endpoints
  app.head("/api/blobs/:digest", ollamaProxy);                 // Check blob exists
  app.post("/api/blobs/:digest", express.raw({ type: "application/octet-stream", limit: "10gb" }), ollamaProxy);

  logger.info(`[SERVER] Ollama API endpoints enabled (serving=${SERVING_MODE}, backend=${BACKEND_MODE})`);
  logger.info(`[SERVER] Ollama endpoints proxy to: ${ollamaBackendUrl}`);
} else {
  logger.info(`[SERVER] Ollama API endpoints disabled (serving=${SERVING_MODE}, backend=${BACKEND_MODE})`);
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

const server: Server = app.listen(PROXY_PORT, PROXY_HOST, () => {
  const addressInfo = server.address() as AddressInfo | null;
  
  if (!addressInfo) {
    logger.error('[SERVER] Failed to get server address information');
    process.exit(1);
  }
  
  const actualPort = addressInfo.port;
  const host = addressInfo.address;

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
  logger.info(createAlignedLine(chalk.cyan(`  OpenAI: /v1/chat/completions`)));
  if (SERVING_MODE === "ollama" || IS_OLLAMA_MODE) {
    logger.info(createAlignedLine(chalk.cyan(`  Ollama: /api/chat, /api/generate, /api/*`)));
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