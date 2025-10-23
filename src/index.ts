
import os from "os";

import chalk from "chalk";
import express from "express";
import stringWidth from "string-width";

import {
  BACKEND_LLM_BASE_URL,
  CHAT_COMPLETIONS_FULL_URL,
  OLLAMA_DEFAULT_CONTEXT_LENGTH,
  PROXY_HOST,
  PROXY_PORT,
  validateConfig,
} from "./config.js";
import genericProxy from "./genericProxy.js";
// import azureBridgeRouter from "./handlers/azureBridgeExpressRouter.js";
import chatCompletionsHandler from "./handlers/chatHandler.js";
import logger from "./utils/logger.js";
import { logRequest, logResponse } from "./utils/requestLogger.js";

// Import types
import type { OllamaRequest, OllamaShowResponse } from "./types/index.js";
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

app.post("/api/show", express.json(), (req: Request<{}, OllamaShowResponse, OllamaRequest>, res: Response<OllamaShowResponse | { error: string }>) => {
  logRequest(req, "OLLAMA SHOW");
  logger.debug("[OLLAMA SHOW] Body:", JSON.stringify(req.body, null, 2));
  logger.debug("[OLLAMA SHOW] Headers:", JSON.stringify(req.headers, null, 2));

  const startTime = Date.now();
  try {
    const name: string = req.body.model;

    if (!name) {
      res.status(400).json({ error: "Missing required field: model" });
      return;
    }

    const modelResponse: OllamaShowResponse = {
      license: "Apache 2.0 License",
      modelfile: `FROM ${name}\\nTEMPLATE \"{{.System}}\\n\\n{{.Prompt}}\"\\nPARAMETER temperature 0.7\\nPARAMETER top_p 0.9`,
      template: "{{.System}}\\n\\n{{.Prompt}}",
      details: {
        parent_model: "",
        format: "gguf",
        family: "llama",
        families: ["llama"],
        parameter_size: "7B",
        quantization_level: "Q4_0",
      },
      model_info: {
        "general.architecture": "llama",
        "general.file_type": 2,
        "general.parameter_count": 6738415616,
        "general.quantization_version": 2,
        "llama.attention.head_count": 32,
        "llama.attention.head_count_kv": 32,
        "llama.attention.layer_norm_rms_epsilon": 0.000001,
        "llama.block_count": 32,
        "llama.context_length": OLLAMA_DEFAULT_CONTEXT_LENGTH,
        "llama.embedding_length": 4096,
        "llama.feed_forward_length": 11008,
        "llama.rope.dimension_count": 128,
        "llama.rope.freq_base": 10000,
        "llama.vocab_size": 32000,
        "tokenizer.ggml.bos_token_id": 1,
        "tokenizer.ggml.eos_token_id": 2,
        "tokenizer.ggml.model": "llama",
        "tokenizer.ggml.padding_token_id": 0,
        "tokenizer.ggml.unknown_token_id": 0,
      },
    };

    res.json(modelResponse);
    logResponse(200, "OLLAMA SHOW", Date.now() - startTime);
  } catch (error: unknown) {
    logger.error("[OLLAMA SHOW] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      error: `Error processing show request: ${errorMessage}`,
    });
  }
});

// Chat completions endpoint
app.post("/v1/chat/completions", express.json({ limit: "50mb" }), chatCompletionsHandler);

// Add support for Ollama's /api/chat endpoint
app.post("/api/chat", express.json({ limit: "50mb" }), chatCompletionsHandler);

// Azure ⇄ OpenAI Bridge routes
// app.use("/bridge", azureBridgeRouter);

// Generic proxy for all other endpoints
app.use("/v1", genericProxy);

// 404 handler - Express 5 compatible
app.use((_req: Request, res: Response) => {
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

  const displayHost = host === "0.0.0.0" ? "localhost" : host;

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
      chalk.yellow("➤ ") + chalk.cyan(`Proxying to:  `) + chalk.green(`${BACKEND_LLM_BASE_URL}`)
    )
  );

  if (!process.env.OLLAMA_BASE_URL) {
    logger.warn(createAlignedLine(chalk.yellow("⚠ ") + chalk.yellow.dim("OLLAMA_BASE_URL not set")));
  }

  logger.info(middleSeparator);
  logger.info(createAlignedLine(chalk.magenta("Available at:")));
  logger.info(createAlignedLine(chalk.cyan(`  http://${displayHost}:${actualPort}/v1/chat/completions`)));
  logger.info(createAlignedLine(chalk.cyan(`  http://localhost:${actualPort}/`)));
  logger.info(createAlignedLine(chalk.dim(`  Network: http://${getNetworkIP()}:${actualPort}/`)));
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