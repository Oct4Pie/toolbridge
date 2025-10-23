import { spawn } from "child_process";

import { expect } from "chai";
import { before, after, describe, it } from "mocha";


import { detectPotentialToolCall } from "../../handlers/toolCallHandler.js";
import { attemptPartialToolCallExtraction } from "../../utils/xmlUtils.js";

import type { ExtractedToolCall, ToolCallDetectionResult, PartialExtractionResult } from "../../types/index.js";
import type { ChildProcess } from "child_process";

describe("Integration Tests", function () {
  this.timeout(20000);

  const PROXY_PORT = process.env.PROXY_PORT ? parseInt(process.env.PROXY_PORT, 10) : 3000;
  const BASE_URL = `http://localhost:${PROXY_PORT}`;
  const TEST_MODEL = process.env.TEST_MODEL ?? "gpt-4o-mini"; // must be valid for your real backend

  let serverProcess: ChildProcess | null = null;
  let startedServer = false;

  before(async function () {
    // Ping the real server; if unavailable, start it for this suite
    try {
      const res = await fetch(`${BASE_URL}/`);
      expect(res.ok).to.be.true;
    } catch (_e) {
      serverProcess = spawn("npm", ["start"], { env: { ...process.env } });
      startedServer = true;
      // Wait until the server responds or timeout after ~20s
      const deadline = Date.now() + 20000;
      // Small delay before first probe
      await new Promise(resolve => setTimeout(resolve, 500));
      // Poll loop
       
      let serverReady = false;
      while (!serverReady) {
        try {
          await fetch(`${BASE_URL}/`);
          serverReady = true;
        } catch {
          // ignore until timeout
        }
        if (Date.now() > deadline) {
          throw new Error(`Failed to start ToolBridge at ${BASE_URL} within timeout.`);
        }
        if (!serverReady) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
  });

  async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 2): Promise<Response> {
    let attempt = 0;
    for (;;) {
      const res = await fetch(url, init);
      if (res.status !== 429 || attempt >= maxRetries) { return res; }
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Math.min(Number(retryAfterHeader) * 1000 || 0, 3000) : 0;
      const backoff = retryAfterMs || Math.min(500 * (2 ** attempt), 3000);
      await new Promise(resolve => setTimeout(resolve, backoff));
      attempt++;
    }
  }

  after(function () {
    if (startedServer && serverProcess) {
      try { serverProcess.kill(); } catch { /* noop */ }
      serverProcess = null;
    }
  });

  describe("Non-streaming completions", function () {
    it("should proxy non-streaming requests correctly", async function () {
    const response = await fetchWithRetry(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello" }],
      model: TEST_MODEL,
          stream: false
        })
      });

    expect(response.ok).to.be.true;
    const data = await response.json() as Record<string, unknown>;
    expect(data).to.have.property("choices");
    const choices = (data.choices as Array<Record<string, unknown>>);
    expect(choices).to.be.an("array").with.length.greaterThan(0);
    const message = choices[0].message as Record<string, unknown> | undefined;
    // Either content or tool_calls may be present depending on the model
    expect(!!(message && (message.content ?? message.tool_calls))).to.be.true;
    });
  });

  describe("Streaming completions", function () {
    it("should handle streaming responses", async function () {
  const response = await fetchWithRetry(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello" }],
          model: TEST_MODEL,
          stream: true
        })
  });

      expect(response.ok).to.be.true;
      expect(response.headers.get("content-type")).to.include("text/event-stream");
      
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No reader available");
      }

      let chunks: string[] = [];
      const decoder = new TextDecoder();
      
      try {
        for (;;) {
          const readResult = await reader.read();
          if (readResult.done) { break; }

          const chunk = decoder.decode(readResult.value);
          chunks.push(chunk);

          if (chunk.includes("[DONE]")) { break; }
        }
      } finally {
        reader.releaseLock();
      }

      expect(chunks.length).to.be.greaterThan(0);
      const fullResponse = chunks.join("");
      // Expect at least one data line and a DONE marker
      expect(fullResponse).to.match(/data: \{/);
      expect(fullResponse).to.include("[DONE]");
    });
  });

  describe("Tool call detection", function () {
    it("should detect potential tool calls in streaming content", function () {
      const knownTools = ["search", "calculate", "think"];
      const content = "<search><query>test";
      
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownTools);
      
      expect(result.isPotential).to.be.true;
      expect(result.rootTagName).to.equal("search");
    });

    it("should extract complete tool calls", function () {
      const knownTools = ["search", "calculate", "think"];
      const content = "<search><query>test query</query></search>";
      
      const result: PartialExtractionResult = attemptPartialToolCallExtraction(content, knownTools);
      
      expect(result.complete).to.be.true;
  expect(result.toolCall).to.not.be.null;
  const toolCall = result.toolCall as ExtractedToolCall;
  expect(toolCall.name).to.equal("search");
  expect((toolCall.arguments as Record<string, unknown>).query).to.equal("test query");
    });
  });

  describe("Error handling", function () {
    it("should handle malformed requests gracefully", async function () {
  const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: "invalid format"
        })
      });

      expect(response.status).to.be.oneOf([400, 500]);
    });
  });
});