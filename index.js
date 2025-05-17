import chalk from "chalk";
import express from "express";
import os from "os";
import stringWidth from "string-width";
import {
  BACKEND_LLM_BASE_URL,
  CHAT_COMPLETIONS_FULL_URL,
  OLLAMA_DEFAULT_CONTEXT_LENGTH,
  PLACEHOLDER_OLLAMA_URL,
  PROXY_HOST,
  PROXY_PORT,
  validateConfig,
} from "./src/config.js";
import genericProxy from "./src/genericProxy.js";
import chatCompletionsHandler from "./src/handlers/chatHandler.js";
import { FORMAT_OLLAMA } from "./src/handlers/formatDetector.js";
import { buildBackendHeaders } from "./src/utils/headerUtils.js";
import logger from "./src/utils/logger.js";
import { logRequest, logResponse } from "./src/utils/requestLogger.js";

validateConfig();

const app = express();

app.get("/", (req, res) => {
  res.json({
    message: "OpenAI Tool Proxy Server is running.",
    status: "OK",
    chat_endpoint: "/v1/chat/completions",
    generic_proxy_base: "/v1",
    target_backend: BACKEND_LLM_BASE_URL,
    target_chat_endpoint: CHAT_COMPLETIONS_FULL_URL,
  });
});

app.post("/api/show", express.json(), async (req, res) => {
  logRequest(req, "OLLAMA SHOW");

  if (logger.debug) {
    logger.debug("[OLLAMA SHOW] Body:", JSON.stringify(req.body, null, 2));
    logger.debug(
      "[OLLAMA SHOW] Headers:",
      JSON.stringify(req.headers, null, 2)
    );
  }

  const startTime = Date.now();
  try {
    const name = req.body.model;

    if (!name) {
      logger.error(
        "[OLLAMA SHOW] Error: Missing model name in request body field 'model'"
      );
      return res
        .status(400)
        .json({ error: "Missing model name in request body field 'model'" });
    }

    logger.debug(`[OLLAMA SHOW] Requested model: ${name}`);

    const { IS_OLLAMA_MODE, OLLAMA_BASE_URL } = await import("./src/config.js");

    if (
      IS_OLLAMA_MODE &&
      OLLAMA_BASE_URL &&
      OLLAMA_BASE_URL !== PLACEHOLDER_OLLAMA_URL
    ) {
      const clientAuthHeader = req.headers["authorization"];
      const backendHeaders = buildBackendHeaders(
        clientAuthHeader,
        req.headers,
        "ollama-show",
        FORMAT_OLLAMA
      );

      logger.debug("[OLLAMA SHOW] Forwarding to Ollama backend");

      const response = await fetch(`${OLLAMA_BASE_URL}/api/show`, {
        method: "POST",
        headers: backendHeaders,
        body: JSON.stringify({ name }),
      });

      let responseData = await response.json();
      if (logger.debug) {
        logger.debug(
          "[OLLAMA SHOW] Original Response:",
          JSON.stringify(responseData, null, 2)
        );
      }

      if (responseData.template) {
        if (!responseData.template.trim().endsWith("ToolCalls")) {
          logger.debug("[OLLAMA SHOW] Adding ToolCalls suffix to template");

          const templateParts = responseData.template.split("\n");
          const lastPart = templateParts[templateParts.length - 1];

          if (lastPart.includes("{{assistant}}")) {
            templateParts[templateParts.length - 1] = lastPart.endsWith(" ")
              ? `${lastPart}ToolCalls`
              : `${lastPart} ToolCalls`;

            responseData.template = templateParts.join("\n");
          } else {
            responseData.template = responseData.template.trim() + " ToolCalls";
          }

          logger.debug(
            `[OLLAMA SHOW] Updated template: "${responseData.template}"`
          );
        } else {
          logger.debug("[OLLAMA SHOW] Template already has ToolCalls suffix");
        }
      } else {
        logger.debug(
          "[OLLAMA SHOW] No template found in response, adding a default one"
        );

        responseData.template = "{{system}}\n{{user}}\n{{assistant}} ToolCalls";
      }

      if (logger.debug) {
        logger.debug(
          "[OLLAMA SHOW] Modified Response:",
          JSON.stringify(responseData, null, 2)
        );
      }

      res.status(response.status).json(responseData);

      const duration = Date.now() - startTime;
      logResponse(response.status, "OLLAMA SHOW", duration);
      return;
    } else {
      logger.debug(
        "[OLLAMA SHOW] No Ollama backend configured, creating synthetic response"
      );

      try {
        const backendHeaders = buildBackendHeaders(null, null, "ollama-show");
        const modelsResponse = await fetch(
          `${BACKEND_LLM_BASE_URL}/v1/models`,
          {
            method: "GET",
            headers: backendHeaders,
          }
        );

        if (!modelsResponse.ok) {
          throw new Error(`Failed to fetch models: ${modelsResponse.status}`);
        }

        const modelsData = await modelsResponse.json();

        const matchingModel = modelsData.data.find(
          (model) =>
            model.id.toLowerCase() === name.toLowerCase() ||
            model.id.toLowerCase().includes(name.toLowerCase())
        );

        if (matchingModel) {
          const contextLength =
            matchingModel.max_model_len || OLLAMA_DEFAULT_CONTEXT_LENGTH;
          logger.debug(
            `[OLLAMA SHOW] Using context length: ${contextLength} (Source: ${
              matchingModel.max_model_len ? "OpenAI model" : "Default config"
            })`
          );

          const modelFamily = matchingModel.id.toLowerCase().includes("llama")
            ? "llama"
            : matchingModel.id.toLowerCase().includes("mistral")
            ? "mistral"
            : matchingModel.id.toLowerCase().includes("qwen")
            ? "qwen"
            : matchingModel.id.toLowerCase().includes("gemma")
            ? "gemma"
            : "llama";

          const ollamaResponse = {
            license: matchingModel.license || "unknown",
            modelfile: `FROM ${matchingModel.id}\nPARAMETER temperature 0.7\nPARAMETER top_p 0.9`,
            parameters: {
              temperature: 0.7,
              top_p: 0.9,
              num_ctx: contextLength,
            },
            template: "{{system}}\n{{user}}\n{{assistant}} ToolCalls",
            system: "You are a helpful AI assistant.",
            details: {
              parent_model: "",
              format: "gguf",
              family: modelFamily,
              families: [modelFamily],
              parameter_size: "7B",
              quantization_level: "Q4_0",
            },
            model_info: {
              "general.architecture": modelFamily,
              "general.file_type": 2,
              "general.parameter_count": 7000000000,
              "general.quantization_version": 2,
              [`${modelFamily}.attention.head_count`]: 32,
              [`${modelFamily}.attention.head_count_kv`]: 8,
              [`${modelFamily}.attention.layer_norm_rms_epsilon`]: 0.00001,
              [`${modelFamily}.block_count`]: 32,
              [`${modelFamily}.context_length`]: contextLength,
              [`${modelFamily}.embedding_length`]: 4096,
              [`${modelFamily}.feed_forward_length`]: 14336,
              [`${modelFamily}.rope.dimension_count`]: 128,
              [`${modelFamily}.rope.freq_base`]: 1000000,
              [`${modelFamily}.vocab_size`]: 32000,
              "tokenizer.ggml.add_bos_token": true,
              "tokenizer.ggml.add_eos_token": false,
              "tokenizer.ggml.bos_token_id": 1,
              "tokenizer.ggml.eos_token_id": 32000,
              "tokenizer.ggml.model": modelFamily,
            },
            tensors: [],
            capabilities: ["completion", "tools"],
          };

          logger.debug("[OLLAMA SHOW] Synthetic response created");
          res.json(ollamaResponse);

          const duration = Date.now() - startTime;
          logResponse(200, "OLLAMA SHOW (synthetic)", duration);
          return;
        } else {
          logger.debug(`[OLLAMA SHOW] Model '${name}' not found`);
          res.status(404).json({
            error: `Model '${name}' not found`,
          });

          const duration = Date.now() - startTime;
          logResponse(404, "OLLAMA SHOW", duration);
          return;
        }
      } catch (error) {
        logger.error("[OLLAMA SHOW] Error creating synthetic response:", error);
        res.status(500).json({
          error: `Failed to get model information: ${error.message}`,
        });

        const duration = Date.now() - startTime;
        logResponse(500, "OLLAMA SHOW", duration);
        return;
      }
    }
  } catch (error) {
    logger.error("[OLLAMA SHOW] Error:", error);
    res.status(500).json({
      error: `Error processing request: ${error.message}`,
    });

    const duration = Date.now() - startTime;
    logResponse(500, "OLLAMA SHOW", duration);
  }
});

app.get("/api/tags", async (req, res) => {
  logRequest(req, "OLLAMA TAGS");

  if (logger.debug) {
    logger.debug(
      "[OLLAMA TAGS] Headers:",
      JSON.stringify(req.headers, null, 2)
    );
  }

  const startTime = Date.now();
  try {
    const { IS_OLLAMA_MODE, OLLAMA_BASE_URL } = await import("./src/config.js");

    if (
      IS_OLLAMA_MODE &&
      OLLAMA_BASE_URL &&
      OLLAMA_BASE_URL !== PLACEHOLDER_OLLAMA_URL
    ) {
      const clientAuthHeader = req.headers["authorization"];
      const backendHeaders = buildBackendHeaders(
        clientAuthHeader,
        req.headers,
        "ollama-tags",
        FORMAT_OLLAMA
      );

      logger.debug("[OLLAMA TAGS] Forwarding to Ollama backend");

      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        method: "GET",
        headers: backendHeaders,
      });

      let responseData = await response.json();

      if (logger.debug) {
        logger.debug(
          "[OLLAMA TAGS] Response:",
          JSON.stringify(responseData, null, 2)
        );
      }

      res.status(response.status).json(responseData);

      const duration = Date.now() - startTime;
      logResponse(response.status, "OLLAMA TAGS", duration);
      return;
    } else {
      logger.debug(
        "[OLLAMA TAGS] No Ollama backend configured, creating synthetic response from /v1/models"
      );

      try {
        const backendHeaders = buildBackendHeaders(null, null, "models");
        const modelsResponse = await fetch(
          `${BACKEND_LLM_BASE_URL}/v1/models`,
          {
            method: "GET",
            headers: backendHeaders,
          }
        );

        if (!modelsResponse.ok) {
          throw new Error(`Failed to fetch models: ${modelsResponse.status}`);
        }

        const modelsData = await modelsResponse.json();
        const ollamaTagsResponse = {
          models: [],
        };

        // Convert OpenAI models format to Ollama models format
        if (modelsData.data && Array.isArray(modelsData.data)) {
          for (const model of modelsData.data) {
            const modelId = model.id;
            const lowerCaseId = modelId.toLowerCase();

            // Detect model family
            const modelFamily = lowerCaseId.includes("llama")
              ? "llama"
              : lowerCaseId.includes("mistral")
              ? "mistral"
              : lowerCaseId.includes("qwen")
              ? "qwen"
              : lowerCaseId.includes("gemma")
              ? "gemma"
              : "unknown";

            // Create timestamp for yesterday (since these are "pre-existing" models)
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const timestamp = yesterday.toISOString();

            // Calculate a synthetic model size (3-5 GB)
            const sizeInBytes = Math.floor(
              3000000000 + Math.random() * 2000000000
            );

            // Generate a fake digest as SHA-256 (64 hex chars)
            const digest = Array.from({ length: 64 })
              .map(() => "0123456789abcdef"[Math.floor(Math.random() * 16)])
              .join("");

            // Determine parameter size based on model name
            let parameterSize = "7B";
            if (lowerCaseId.includes("32b") || lowerCaseId.includes("32-b")) {
              parameterSize = "32B";
            } else if (
              lowerCaseId.includes("14b") ||
              lowerCaseId.includes("14-b")
            ) {
              parameterSize = "14B";
            } else if (
              lowerCaseId.includes("8b") ||
              lowerCaseId.includes("8-b")
            ) {
              parameterSize = "8B";
            } else if (
              lowerCaseId.includes("70b") ||
              lowerCaseId.includes("70-b")
            ) {
              parameterSize = "70B";
            }

            ollamaTagsResponse.models.push({
              name: modelId,
              model: modelId,
              modified_at: timestamp,
              size: sizeInBytes,
              digest: digest,
              details: {
                parent_model: "",
                format: "gguf",
                family: modelFamily,
                families: [modelFamily],
                parameter_size: parameterSize,
                quantization_level: "Q4_K_M",
              },
            });
          }
        }

        if (logger.debug) {
          logger.debug(
            "[OLLAMA TAGS] Synthetic response created:",
            JSON.stringify(ollamaTagsResponse, null, 2)
          );
        }

        res.json(ollamaTagsResponse);

        const duration = Date.now() - startTime;
        logResponse(200, "OLLAMA TAGS (synthetic)", duration);
        return;
      } catch (error) {
        logger.error("[OLLAMA TAGS] Error creating synthetic response:", error);
        res.status(500).json({
          error: `Failed to get models information: ${error.message}`,
        });

        const duration = Date.now() - startTime;
        logResponse(500, "OLLAMA TAGS", duration);
        return;
      }
    }
  } catch (error) {
    logger.error("[OLLAMA TAGS] Error:", error);
    res.status(500).json({
      error: `Error processing request: ${error.message}`,
    });

    const duration = Date.now() - startTime;
    logResponse(500, "OLLAMA TAGS", duration);
  }
});

app.get("/v1/models", async (req, res) => {
  logRequest(req, "MODELS");

  if (logger.debug) {
    logger.debug(
      "[MODELS REQUEST] Query params:",
      JSON.stringify(req.query, null, 2)
    );
    logger.debug(
      "[MODELS REQUEST] Headers:",
      JSON.stringify(req.headers, null, 2)
    );
  }

  const startTime = Date.now();
  try {
    const clientAuthHeader = req.headers["authorization"];
    const backendHeaders = buildBackendHeaders(
      clientAuthHeader,
      req.headers,
      "models"
    );

    logger.debug(
      "[MODELS REQUEST] Backend Headers:",
      JSON.stringify(backendHeaders, null, 2)
    );

    const backendUrl = `${BACKEND_LLM_BASE_URL}/v1/models`;
    logger.debug("[MODELS REQUEST] Forwarding to:", backendUrl);

    const response = await fetch(backendUrl, {
      method: "GET",
      headers: backendHeaders,
    });

    const responseData = await response.text();
    let formattedResponse;

    try {
      formattedResponse = JSON.parse(responseData);

      if (logger.debug) {
        logger.debug(
          "[MODELS RESPONSE] Headers:",
          JSON.stringify(
            Object.fromEntries(response.headers.entries()),
            null,
            2
          )
        );
        logger.debug(
          "[MODELS RESPONSE] Body:",
          JSON.stringify(formattedResponse, null, 2)
        );
      }
    } catch (_) {
      if (logger.debug) {
        logger.debug(
          "[MODELS RESPONSE] Headers:",
          JSON.stringify(
            Object.fromEntries(response.headers.entries()),
            null,
            2
          )
        );
        logger.debug("[MODELS RESPONSE] Body (text):", responseData);
      }
    }

    res.status(response.status);

    response.headers.forEach((value, name) => {
      if (
        name.toLowerCase() !== "content-encoding" &&
        name.toLowerCase() !== "transfer-encoding"
      ) {
        res.setHeader(name, value);
      }
    });

    res.setHeader("Content-Type", "application/json");

    if (formattedResponse) {
      res.send(JSON.stringify(formattedResponse));
    } else {
      res.send(responseData);
    }

    const duration = Date.now() - startTime;
    logResponse(response.status, "MODELS", duration);
  } catch (error) {
    logger.error("[MODELS ERROR]", error);
    res.status(500).json({
      error: {
        message: `Error proxying to models endpoint: ${error.message}`,
        type: "proxy_error",
      },
    });

    const duration = Date.now() - startTime;
    logResponse(500, "MODELS", duration);
  }
});

app.post(
  "/v1/chat/completions",
  express.json({limit: "100mb"}),
  (req, res, next) => {
    logRequest(req, "CHAT COMPLETIONS");
    const startTime = Date.now();

    const originalSend = res.send;
    const originalJson = res.json;
    const originalEnd = res.end;

    res.send = function (...args) {
      const duration = Date.now() - startTime;
      logResponse(res.statusCode, "CHAT COMPLETIONS", duration);
      return originalSend.apply(res, args);
    };

    res.json = function (...args) {
      const duration = Date.now() - startTime;
      logResponse(res.statusCode, "CHAT COMPLETIONS", duration);
      return originalJson.apply(res, args);
    };

    res.end = function (...args) {
      const duration = Date.now() - startTime;
      logResponse(res.statusCode, "CHAT COMPLETIONS (stream)", duration);
      return originalEnd.apply(res, args);
    };

    next();
  },
  chatCompletionsHandler
);

app.use(
  "/v1",
  express.raw({ type: "*/*", limit: "100mb" }),
  (req, res, next) => {
    const path = req.path.split("/")[1] || "root";
    logRequest(req, `PROXY: ${path.toUpperCase()}`);
    const startTime = Date.now();

    const originalSend = res.send;
    const originalJson = res.json;
    const originalEnd = res.end;

    res.send = function (...args) {
      const duration = Date.now() - startTime;
      logResponse(res.statusCode, `PROXY: ${path.toUpperCase()}`, duration);
      return originalSend.apply(res, args);
    };

    res.json = function (...args) {
      const duration = Date.now() - startTime;
      logResponse(res.statusCode, `PROXY: ${path.toUpperCase()}`, duration);
      return originalJson.apply(res, args);
    };

    res.end = function (...args) {
      const duration = Date.now() - startTime;
      logResponse(res.statusCode, `PROXY: ${path.toUpperCase()}`, duration);
      return originalEnd.apply(res, args);
    };

    next();
  },
  genericProxy
);

app.use((req, res, next) => {
  // Only handle if no other routes matched
  const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const method = req.method;

  logger.debug(`[UNDEFINED ROUTE] ${method} ${fullUrl}`);
  console.log(`[UNDEFINED ROUTE] ${method} ${fullUrl}`);

  res.status(404).json({
    error: `Undefined route: ${method} ${req.originalUrl}`,
    message: "This route is not handled by the proxy server.",
  });
});

const server = app.listen(PROXY_PORT, PROXY_HOST, () => {
  const addressInfo = server.address();
  const actualPort = addressInfo.port;
  const host = addressInfo.address;

  const displayHost = host === "0.0.0.0" ? "localhost" : host;

  const BOX_WIDTH = 51;
  const LEFT_MARGIN = 2;
  const BOX_CHAR = {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
    leftT: "├",
    rightT: "┤",
  };

  const createAlignedLine = (content, leftPadding = LEFT_MARGIN) => {
    // eslint-disable-next-line no-control-regex
    const rawContent = content.replace(/\u001b\[\d+(;\d+)*m/g, "");
    const visibleWidth = stringWidth(rawContent);
    const paddingNeeded = BOX_WIDTH - 2 - visibleWidth - leftPadding;
    const padding = " ".repeat(Math.max(0, paddingNeeded));
    return (
      chalk.bold.blue(BOX_CHAR.vertical) +
      " ".repeat(leftPadding) +
      content +
      padding +
      chalk.bold.blue(BOX_CHAR.vertical)
    );
  };

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

  console.log("\n" + topBorder);
  console.log(
    createAlignedLine(
      chalk.bold.green(" 🚀 OpenAI Tool Proxy Server") +
        chalk.bold.green.dim(" Started")
    )
  );
  console.log(middleSeparator);
  console.log(
    createAlignedLine(
      chalk.yellow("➤ ") +
        chalk.cyan(`Listening on: `) +
        chalk.green(`http://${displayHost}:${actualPort}`)
    )
  );
  console.log(createAlignedLine(chalk.dim(`   Binding address: ${host}`)));
  console.log(
    createAlignedLine(
      chalk.yellow("➤ ") +
        chalk.cyan(`Proxying to:  `) +
        chalk.green(`${BACKEND_LLM_BASE_URL}`)
    )
  );

  if (!process.env.OLLAMA_BASE_URL) {
    console.log(
      createAlignedLine(
        chalk.yellow("⚠ ") + chalk.yellow.dim("OLLAMA_BASE_URL not set")
      )
    );
  }

  console.log(middleSeparator);
  console.log(createAlignedLine(chalk.magenta("Available at:")));
  console.log(
    createAlignedLine(chalk.green(`  • http://localhost:${actualPort}`))
  );

  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if ("IPv4" !== iface.family || iface.internal !== false) {
        continue;
      }

      const address = `http://${iface.address}:${actualPort}`;
      console.log(createAlignedLine(chalk.green(`  • ${address}`)));
    }
  }

  console.log(bottomBorder + "\n");
});

server.on("error", (error) => {
  if (error.syscall !== "listen") {
    throw error;
  }

  const bind =
    typeof PROXY_PORT === "string"
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
