#!/usr/bin/env ts-node

/**
 * Comprehensive Feature Test Script
 *
 * Exercises ToolBridge end-to-end using the mock servers and translation demo server.
 */

import { spawn } from "child_process";
import { dirname } from "path";
import { fileURLToPath } from "url";

import axios from "axios";
import chalk from "chalk";

import type { ChildProcess } from "child_process";

const MOCK_OPENAI_PORT = 4001;
const MOCK_OLLAMA_PORT = 4002;
const TRANSLATION_PORT = 4004;
const PROXY_PORT = 3000;

const testResults: Array<{ name: string; status: "passed" | "failed"; error?: string }> = [];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(dirname(__dirname));

function log(message: string, type: "info" | "success" | "error" | "warning" = "info"): void {
  const colors = {
    info: chalk.blue,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
  } as const;
  console.log(colors[type](`[${type.toUpperCase()}] ${message}`));
}

async function waitForServer(url: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      await axios.get(url);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return false;
}

function startServer(command: string, args: string[], name: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    log(`Starting ${name}...`, "info");
    const child = spawn(command, args, {
      stdio: "pipe",
      shell: true,
      env: process.env,
      cwd: projectRoot,
    });

    child.on("error", reject);

    // Give the server time to start
    setTimeout(() => resolve(child), 2000);
  });
}

async function runTest(name: string, testFn: () => Promise<void>): Promise<void> {
  try {
    log(`Running test: ${name}`, "info");
    await testFn();
    testResults.push({ name, status: "passed" });
    log(`✓ ${name}`, "success");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    testResults.push({ name, status: "failed", error: errorMsg });
    log(`✗ ${name}: ${errorMsg}`, "error");
  }
}

async function testTranslationLayer(): Promise<void> {
  const translationUrl = `http://localhost:${TRANSLATION_PORT}`;

  const openaiRequest = {
    model: "gpt-4o",
    messages: [{ role: "user" as const, content: "Hello, world!" }],
    max_tokens: 100,
    temperature: 0.7,
  };

  const response = await axios.post(`${translationUrl}/translate`, {
    from: "openai",
    to: "ollama",
    request: openaiRequest,
  });

  if (!response.data.success) {
    throw new Error("Translation failed");
  }

  const ollamaRequest = response.data.data;
  if (!ollamaRequest.messages || ollamaRequest.num_predict !== 100) {
    throw new Error("Translation did not properly convert fields");
  }
}

async function testMockOpenAIServer(): Promise<void> {
  const response = await axios.post(`http://localhost:${MOCK_OPENAI_PORT}/v1/chat/completions`, {
    model: "gpt-4o",
    messages: [{ role: "user", content: "Test message" }],
    tools: [
      {
        type: "function" as const,
        function: {
          name: "get_weather",
          description: "Get weather information",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
  });

  if (!response.data.id || !response.data.choices) {
    throw new Error("Invalid OpenAI mock response format");
  }
}

async function testMockOllamaServer(): Promise<void> {
  const response = await axios.post(`http://localhost:${MOCK_OLLAMA_PORT}/api/chat`, {
    model: "llama3",
    messages: [{ role: "user", content: "Test message" }],
    stream: false,
  });

  if (!response.data.message || !response.data.done) {
    throw new Error("Invalid Ollama mock response format");
  }
}

async function testStreamProcessing(): Promise<void> {
  const response = await axios.post(
    `http://localhost:${MOCK_OPENAI_PORT}/v1/chat/completions`,
    {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Stream test" }],
      stream: true,
    },
    { responseType: "stream" },
  );

  await new Promise<void>((resolve, reject) => {
    let chunkCount = 0;

    response.data.on("data", (chunk: Buffer) => {
      chunkCount += 1;
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            if (chunkCount > 0) {
              resolve();
            } else {
              reject(new Error("No chunks received"));
            }
            return;
          }
          try {
            JSON.parse(data);
          } catch {
            // Skip non-JSON lines
          }
        }
      }
    });

    response.data.on("error", reject);

    setTimeout(() => reject(new Error("Stream timeout")), 10000);
  });
}

async function testToolCallDetection(): Promise<void> {
  const response = await axios.post(`http://localhost:${MOCK_OPENAI_PORT}/v1/chat/completions`, {
    model: "gpt-4o",
    messages: [{ role: "user", content: "What is the weather?" }],
    tools: [
      {
        type: "function" as const,
        function: {
          name: "get_weather",
          parameters: { type: "object" },
        },
      },
    ],
  });

  const hasToolCall = response.data.choices[0].message.tool_calls !== undefined;
  if (!hasToolCall && response.data.choices[0].finish_reason !== "stop") {
    throw new Error("Tool call detection issue");
  }
}

async function main(): Promise<void> {
  const servers: ChildProcess[] = [];

  try {
    log("Starting ToolBridge Feature Tests", "info");
    log("================================", "info");

    log("Starting mock servers...", "info");

    log("Building TypeScript files...", "info");
    await new Promise<void>((resolve, reject) => {
  const build = spawn("npm", ["run", "build"], { stdio: "inherit", shell: true, cwd: projectRoot });
      build.on("close", (code) => (code === 0 ? resolve() : reject(new Error("Build failed"))));
    });

    const openaiServer = await startServer(
      "node",
      ["dist/test-servers/mock-openai-server.js"],
      "Mock OpenAI Server",
    );
    servers.push(openaiServer);

    const ollamaServer = await startServer(
      "node",
      ["dist/test-servers/mock-ollama-server.js"],
      "Mock Ollama Server",
    );
    servers.push(ollamaServer);

    const translationServer = await startServer(
      "node",
      ["dist/src/server/translationDemoServer.js"],
      "Translation Server",
    );
    servers.push(translationServer);

    const proxyServer = await startServer(
      "node",
      ["dist/src/index.js"],
      "ToolBridge Proxy",
    );
    servers.push(proxyServer);

    log("Waiting for servers to be ready...", "info");
    const ready = await Promise.all([
      waitForServer(`http://localhost:${MOCK_OPENAI_PORT}/health`),
      waitForServer(`http://localhost:${MOCK_OLLAMA_PORT}/health`),
      waitForServer(`http://localhost:${TRANSLATION_PORT}/health`),
      waitForServer(`http://localhost:${PROXY_PORT}/health`),
    ]);

    if (ready.some((isReady) => !isReady)) {
      throw new Error("One or more servers failed to start");
    }

    log("Running feature tests...", "info");
    log("========================", "info");

    await runTest("Translation Layer: OpenAI → Ollama", testTranslationLayer);
    await runTest("Mock OpenAI Server", testMockOpenAIServer);
    await runTest("Mock Ollama Server", testMockOllamaServer);
    await runTest("Stream Processing", testStreamProcessing);
    await runTest("Tool Call Detection", testToolCallDetection);

    log("\nTest Results Summary", "info");
    log("====================", "info");

    const passed = testResults.filter((t) => t.status === "passed").length;
    const failed = testResults.filter((t) => t.status === "failed").length;

    testResults.forEach((result) => {
      const icon = result.status === "passed" ? "✓" : "✗";
      const color = result.status === "passed" ? chalk.green : chalk.red;
      console.log(color(`${icon} ${result.name}`));
      if (result.error) {
        console.log(chalk.gray(`  Error: ${result.error}`));
      }
    });

    log(`\nTotal: ${passed} passed, ${failed} failed`, failed > 0 ? "warning" : "success");

    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    log(`Fatal error: ${error}`, "error");
    process.exit(1);
  } finally {
    log("Cleaning up servers...", "info");
    servers.forEach((server) => {
      try {
        server.kill();
      } catch {
        // Ignore cleanup errors
      }
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    log(`Unhandled error: ${error}`, "error");
    process.exit(1);
  });
}

export { main };
