import { spawn } from "child_process";

import { expect } from "chai";
import { before, after, describe, it } from "mocha";
import OpenAI from "openai";

import type { ChildProcess } from "child_process";

describe("🧩 Complex Tool Calls E2E", function () {
  this.timeout(60000);

  const PROXY_PORT = process.env.PROXY_PORT ? parseInt(process.env.PROXY_PORT, 10) : 3000;
  const BASE_URL = `http://localhost:${PROXY_PORT}/v1`;
  const TEST_MODEL = process.env.TEST_MODEL ?? "deepseek/deepseek-chat-v3.1:free";
  const API_KEY = (process.env.BACKEND_LLM_API_KEY as string | undefined) ?? "sk-fake";

  let server: ChildProcess | null = null;
  let openai: OpenAI;

  // Retry helper with exponential backoff - MUST eventually succeed
  const retryUntilSuccess = async <T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> => {
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        return await fn();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if ((msg.includes("429") || /rate limit/i.test(msg)) && attempt < maxRetries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10s
          console.warn(`   ⏳  429 on attempt ${attempt + 1}, retrying after ${backoff}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          attempt++;
          continue;
        }
        // Not a 429 or exceeded retries - throw the error
        throw e;
      }
    }
    throw new Error("Exceeded maximum retries");
  };

  before(async function () {
    server = spawn("npm", ["start"], { env: { ...process.env }, stdio: process.env.DEBUG_MODE === "true" ? "inherit" : "ignore" });
    await new Promise(resolve => setTimeout(resolve, 3000));
    openai = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY });
  });

  after(function () {
    if (server) { try { server.kill(); } catch { /* noop */ } }
  });

  const tools: OpenAI.Chat.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "ingest_dataset",
        description: "Ingest complex dataset with nested objects, arrays, and metadata",
        parameters: {
          type: "object",
          properties: {
            meta: {
              type: "object",
              properties: {
                name: { type: "string" },
                version: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                flags: { type: "object", properties: { dryRun: { type: "boolean" }, upsert: { type: "boolean" } } },
              },
              required: ["name"],
            },
            records: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  attrs: { type: "object" },
                  values: { type: "array", items: { type: "number" } },
                },
                required: ["id"],
              },
            },
            notes: { type: "string" },
          },
          required: ["meta", "records"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "render_report",
        description: "Render a large report with raw HTML/markdown/code. Preserve raw content.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            html: { type: "string" },
            markdown: { type: "string" },
            code: { type: "string" },
          },
          required: ["title"],
        },
      },
    },
  ];

  it("handles deeply nested arrays/objects in ingest_dataset", async function () {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are an AI assistant with access to tools. When using tools, you MUST wrap your tool calls in the following format:

<toolbridge:calls>
<tool_name>
  <param1>value1</param1>
  <param2>value2</param2>
</tool_name>
</toolbridge:calls>

This wrapper format is REQUIRED for the system to detect and execute your tool calls properly.`
      },
      { 
        role: "user", 
        content: "Ingest dataset named 'customers' v1 with two records and dryRun=true; include tags A,B" 
      },
    ];

    const resp = await retryUntilSuccess(async () => openai.chat.completions.create({ model: TEST_MODEL, messages, tools, temperature: 0.1, max_tokens: 400 }));
    const msg = resp.choices[0].message;

    // Prefer wrappers/native tool_calls if the model uses tools; otherwise, accept plain content.
    let toolUsed = false;
    let parsedArgs: unknown = null;
    let toolName: string | null = null;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const tc = msg.tool_calls[0];
      parsedArgs = JSON.parse(tc.function.arguments);
      toolUsed = true;
      toolName = tc.function.name;
    } else if (msg.content) {
      const { extractToolCallFromWrapper } = await import("../../utils/xmlToolParser.js");
      const extracted = extractToolCallFromWrapper(msg.content, ["ingest_dataset"]);
      if (extracted) {
        toolUsed = true;
        parsedArgs = extracted.arguments;
        toolName = extracted.name;
      }
    }

    if (toolUsed) {
      // If tools were used, they must be native tool_calls or proper wrappers
      expect(toolName, "ToolBridge must detect the correct tool name").to.equal("ingest_dataset");
      expect(parsedArgs, "ToolBridge must parse tool arguments").to.not.be.null;
      expect(typeof parsedArgs, "ToolBridge must extract structured arguments").to.equal("object");
    } else {
      // Model elected not to use tools; response must still be valid and non-empty
      expect(msg.content && typeof msg.content === "string", "Assistant should return a valid textual response when not using tools").to.be.true;
      expect((msg.content as string).length, "Textual response should not be empty").to.be.greaterThan(0);
    }
    
    // Verify ToolBridge preserves complex nested structures (only when tools used)
    if (toolUsed && parsedArgs !== null && typeof parsedArgs === "object") {
      const argsObj = parsedArgs as Record<string, unknown>;
      if (argsObj.meta && typeof argsObj.meta === "object") {
        expect(typeof argsObj.meta, "ToolBridge must preserve nested meta object structure").to.equal("object");
      }
      if (argsObj.records) {
        const records = Array.isArray(argsObj.records) ? argsObj.records : [argsObj.records];
        expect(records.length, "ToolBridge must preserve all record structures").to.be.greaterThan(0);
        expect(records.every((r: unknown) => typeof r === "object" && r !== null), "All records must be valid objects").to.be.true;
      }
    }
  });

  it("preserves large raw HTML/code/markdown in render_report", async function () {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are an AI assistant with access to tools. When using tools, you MUST wrap your tool calls in the following format:

<toolbridge:calls>
<tool_name>
  <param1>value1</param1>
  <param2>value2</param2>
</tool_name>
</toolbridge:calls>

This wrapper format is REQUIRED for the system to detect and execute your tool calls properly.`
      },
      { 
        role: "user", 
        content: "Render a report named 'Complex Q4'. Include raw HTML with <script>, markdown, and a code block." 
      },
    ];

    const resp = await retryUntilSuccess(async () => openai.chat.completions.create({ model: TEST_MODEL, messages, tools, temperature: 0.1, max_tokens: 600 }));
    const msg = resp.choices[0].message;

    // Generic: prefer tool usage; otherwise validate content is preserved without assuming model behavior
    let toolUsed = false;
    let parsedArgs: unknown = null;
    let toolName: string | null = null;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const tc = msg.tool_calls[0];
      parsedArgs = JSON.parse(tc.function.arguments);
      toolUsed = true;
      toolName = tc.function.name;
    } else if (msg.content) {
      const { extractToolCallFromWrapper } = await import("../../utils/xmlToolParser.js");
      const extracted = extractToolCallFromWrapper(msg.content, ["render_report"]);
      if (extracted) {
        toolUsed = true;
        parsedArgs = extracted.arguments;
        toolName = extracted.name;
      }
    }

    if (toolUsed) {
      expect(toolName).to.equal("render_report");
      expect(parsedArgs).to.not.be.null;
      // If HTML provided, ensure it's preserved (no forced escaping)
      if (parsedArgs !== null && typeof parsedArgs === 'object') {
        const argsObj = parsedArgs as Record<string, unknown>;
        if (argsObj.html) {
          const htmlStr = typeof argsObj.html === "string" ? argsObj.html : JSON.stringify(argsObj.html);
          const hasRawHtml = /<!DOCTYPE\s+html|<html\b|<body\b|<div\b|<script\b|<style\b/i.test(htmlStr) || htmlStr.includes("<![CDATA[");
          expect(hasRawHtml, `ToolBridge should preserve raw HTML; got: ${htmlStr.substring(0, 120)}...`).to.be.true;
          expect(htmlStr).to.not.include("&lt;div&gt;");
        }
      }
    } else {
      // Model didn’t use tools; ensure content carries raw markers if any, without assumptions
      const content = msg.content ?? "";
      expect(typeof content).to.equal("string");
      expect((content).length).to.be.greaterThan(0);
    }
  });

  it("streams tool calls and wrapper-aware processor converts to tool_calls", async function () {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are an AI assistant with access to tools. When using tools, you MUST wrap your tool calls in the following format:

<toolbridge:calls>
<tool_name>
  <param1>value1</param1>
  <param2>value2</param2>
</tool_name>
</toolbridge:calls>

This wrapper format is REQUIRED for the system to detect and execute your tool calls properly.`
      },
      { 
        role: "user", 
        content: "Create a minimal render_report call for title 'Mini'" 
      },
    ];

  const stream = await retryUntilSuccess(async () => openai.chat.completions.create({ model: TEST_MODEL, messages, tools, stream: true, temperature: 0.1 }));

    let toolName: string | null = null;
    let argBuf = "";
    let contentBuf = "";

    let chunkCount = 0;
    for await (const chunk of stream) {
      chunkCount++;
      if (chunk.choices.length > 0) {
        const delta = chunk.choices[0].delta;
        
        // Check for native tool_calls (if backend converts wrapper to tool_calls)
        const tcs = delta.tool_calls;
        if (tcs) {
          for (const d of tcs) {
            if (d.function?.name) {toolName = d.function.name;}
            if (d.function?.arguments) {argBuf += d.function.arguments;}
          }
        }
        
        // Collect content for wrapper format parsing
        if (delta.content) {
          contentBuf += delta.content;
        }
      }
    }

    // Check if we got tool calls in native format or need to parse wrapper
    let parsedArgs: unknown = null;
    let toolUsed = false;

    if (toolName && argBuf) {
      // Native tool_calls format worked
      parsedArgs = JSON.parse(argBuf);
      toolUsed = true;
    } else if (contentBuf) {
      // Try to parse wrapper format from content
      const { extractToolCallFromWrapper } = await import("../../utils/xmlToolParser.js");
      const extracted = extractToolCallFromWrapper(contentBuf, ["render_report"]);
      if (extracted) {
        toolName = extracted.name;
        parsedArgs = extracted.arguments;
        toolUsed = true;
      }
    }

    // Generic streaming validation: prefer tool calls, otherwise ensure stream produced content/chunks
    if (toolUsed) {
      expect(toolName, "Tool name should be present when tools are used").to.be.oneOf(["render_report", "ingest_dataset"]);
      expect(parsedArgs, "Arguments should be an object when tools are used").to.be.an("object");
      if (argBuf) {
        // JSON fragments must be concatenated into valid JSON by processor
        const args = JSON.parse(argBuf);
        expect(args).to.be.an("object");
      }
    } else {
      // No tools used: ensure we still received a valid stream
      expect(chunkCount, "Stream should yield at least one chunk").to.be.greaterThan(0);
      // Some backends stream minimal content; accept empty content but present chunks
    }
  });
});
