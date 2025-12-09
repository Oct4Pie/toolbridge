#!/usr/bin/env ts-node
/**
 * Standalone Comprehensive Tool Calling Test Script (with Auto-Detection)
 * 
 * Tests all tool calling scenarios with automatic backend detection.
 * The proxy detects the backend based on model name format:
 * - Models with "/" → OpenAI backend  
 * - Models without "/" → Ollama backend
 * 
 * Usage:
 *   ts-node scripts/manual/test-comprehensive-tool-calling.ts
 */

import { spawn, type ChildProcess } from "child_process";

import OpenAI from "openai";

// Configuration
const MOCK_OPENAI_PORT = Number(process.env['MOCK_OPENAI_PORT'] ?? "3001");
const MOCK_OLLAMA_PORT = Number(process.env['MOCK_OLLAMA_PORT'] ?? "11434");
const MOCK_OPENAI_BASE_URL = `http://localhost:${MOCK_OPENAI_PORT}`;
const MOCK_OLLAMA_BASE_URL = `http://localhost:${MOCK_OLLAMA_PORT}`;
const PROXY_PORT = parseInt(process.env['PROXY_PORT'] ?? "3100", 10);
const PROXY_HOST = process.env['PROXY_HOST'] ?? "localhost";
const BASE_URL = `http://${PROXY_HOST}:${PROXY_PORT}`;
const OPENAI_MODEL = process.env['TEST_MODEL_OPENAI'] ?? "deepseek/deepseek-chat-v3.1:free";
const OLLAMA_MODEL = process.env['TEST_MODEL_OLLAMA'] ?? "llama3.2:1b";
const API_KEY = process.env['BACKEND_LLM_API_KEY'] ?? "sk-test";

console.log("\n🧪 STANDALONE COMPREHENSIVE TOOL CALLING TEST (AUTO-DETECTION)");
console.log("=".repeat(60));
console.log(`Proxy: ${BASE_URL}`);
console.log(`OpenAI Model: ${OPENAI_MODEL} → auto-detects OpenAI backend`);
console.log(`Ollama Model: ${OLLAMA_MODEL} → auto-detects Ollama backend`);
console.log("=".repeat(60) + "\n");

// Tool definitions
const weatherTool: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get weather information",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string" }
      },
      required: ["location"]
    }
  }
};

// Test runner
async function runTests() {
  let mockOpenAIServer: ChildProcess | null = null;
  let mockOllamaServer: ChildProcess | null = null;
  let proxyServer: ChildProcess | null = null;

  try {
    const waitForHealth = async (url: string, label: string, attempts = 60, delayMs = 250) => {
      let attempt = 0;
      while (attempt < attempts) {
        try {
          const response = await fetch(url);
          if (response.ok) {
            return;
          }
        } catch {
          // Not ready
        }
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      throw new Error(`${label} failed to start after ${attempts} attempts`);
    };

    console.log("🛠️  Starting mock providers...");

    mockOpenAIServer = spawn("node", ["dist/test-servers/mock-openai-server.js"], {
      env: { ...process.env },
      stdio: ["ignore", process.env['DEBUG_MODE'] === "true" ? "inherit" : "ignore", "pipe"],
    });

    mockOllamaServer = spawn("node", ["dist/test-servers/mock-ollama-server.js"], {
      env: {
        ...process.env
      },
      stdio: ["ignore", process.env['DEBUG_MODE'] === "true" ? "inherit" : "ignore", "pipe"],
    });

    mockOpenAIServer.stderr?.on("data", (data: Buffer) => {
      console.error(`[Mock OpenAI Error] ${data.toString()}`);
    });
    mockOllamaServer.stderr?.on("data", (data: Buffer) => {
      console.error(`[Mock Ollama Error] ${data.toString()}`);
    });

    await waitForHealth(`${MOCK_OPENAI_BASE_URL}/health`, "Mock OpenAI server");
    await waitForHealth(`${MOCK_OLLAMA_BASE_URL}/health`, "Mock Ollama server");
    console.log("✅ Mock providers ready");

    console.log("📦 Starting ToolBridge proxy server...");
    proxyServer = spawn("node", ["dist/src/index.js"], {
      env: {
        ...process.env,
        PROXY_PORT: PROXY_PORT.toString(),
        DEBUG_MODE: "false",
        BACKEND_MODE: "auto",
        BACKEND_LLM_API_KEY: API_KEY,
        BACKEND_LLM_BASE_URL: MOCK_OPENAI_BASE_URL,
        OLLAMA_BASE_URL: MOCK_OLLAMA_BASE_URL
      }
    });

    console.log("⏳ Waiting for server to start...");
    let attempts = 0;
    let serverReady = false;
    
    while (!serverReady && attempts < 40) {
      try {
        const response = await fetch(`${BASE_URL}/`);
        serverReady = response.ok;
      } catch {
        // Not ready
      }
      
      if (!serverReady) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (!serverReady) {
      throw new Error("Server failed to start");
    }

    console.log("✅ Proxy server ready\n");

    const openaiClient = new OpenAI({
      baseURL: `${BASE_URL}/v1`,
      apiKey: API_KEY
    });

    let passCount = 0;
    let failCount = 0;

    // Test 1: OpenAI model (auto-detect OpenAI backend)
    console.log("🔷 Test 1: OpenAI model → auto-detect OpenAI backend");
    try {
      const response = await openaiClient.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: "What's the weather in SF?" }],
        tools: [weatherTool],
        temperature: 0.1,
        max_tokens: 100
      });
      
      if (response.choices && response.choices.length > 0) {
        console.log("   ✅ PASS");
        passCount++;
      } else {
        console.log("   ❌ FAIL: No choices");
        failCount++;
      }
    } catch (error) {
      console.log(`   ❌ FAIL: ${error instanceof Error ? error.message : String(error)}`);
      failCount++;
    }

    // Test 2: Ollama model (auto-detect Ollama backend)
    console.log("\n🔶 Test 2: Ollama model → auto-detect Ollama backend");
    try {
      const response = await openaiClient.chat.completions.create({
        model: OLLAMA_MODEL,
        messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
        tools: [weatherTool],
        temperature: 0.1,
        max_tokens: 100
      });
      
      if (response.choices && response.choices.length > 0) {
        console.log("   ✅ PASS");
        passCount++;
      } else {
        console.log("   ❌ FAIL: No choices");
        failCount++;
      }
    } catch (error) {
      console.log(`   ❌ FAIL: ${error instanceof Error ? error.message : String(error)}`);
      failCount++;
    }

    // Test 3: Streaming with auto-detection
    console.log("\n🔷 Test 3: Streaming with OpenAI model");
    try {
      const stream = await openaiClient.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: "Say hello." }],
        temperature: 0.1,
        max_tokens: 50,
        stream: true
      });

      let chunkCount = 0;
      for await (const _chunk of stream) {
        chunkCount++;
      }

      if (chunkCount > 0) {
        console.log(`   ✅ PASS (${chunkCount} chunks)`);
        passCount++;
      } else {
        console.log("   ❌ FAIL: No chunks");
        failCount++;
      }
    } catch (error) {
      console.log(`   ❌ FAIL: ${error instanceof Error ? error.message : String(error)}`);
      failCount++;
    }

    // Test 4: No tools baseline
    console.log("\n🎯 Test 4: No tools baseline");
    try {
      const response = await openaiClient.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: "Hello!" }],
        temperature: 0.1,
        max_tokens: 50
      });
      
      if (response.choices && response.choices.length > 0) {
        console.log("   ✅ PASS");
        passCount++;
      } else {
        console.log("   ❌ FAIL: No choices");
        failCount++;
      }
    } catch (error) {
      console.log(`   ❌ FAIL: ${error instanceof Error ? error.message : String(error)}`);
      failCount++;
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 TEST SUMMARY");
    console.log("=".repeat(60));
    console.log(`✅ Passed: ${passCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`📈 Total:  ${passCount + failCount}`);
    console.log(`🎯 Success Rate: ${Math.round((passCount / (passCount + failCount)) * 100)}%`);
    console.log("=".repeat(60) + "\n");

    if (failCount === 0) {
      console.log("🎉 All tests passed!");
      process.exit(0);
    } else {
      console.log("⚠️  Some tests failed");
      process.exit(1);
    }

  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  } finally {
    if (proxyServer) {
      console.log("\n🛑 Stopping proxy server...");
      proxyServer.kill("SIGTERM");
    }
    if (mockOpenAIServer) {
      console.log("🛑 Stopping mock OpenAI server...");
      mockOpenAIServer.kill("SIGTERM");
    }
    if (mockOllamaServer) {
      console.log("🛑 Stopping mock Ollama server...");
      mockOllamaServer.kill("SIGTERM");
    }
  }
}

// Run tests
runTests().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
