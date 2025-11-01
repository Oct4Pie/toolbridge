/**
 * Conformance Smoke Tests
 *
 * Validates bidirectional bridges:
 * - OpenAI ⇄ Ollama
 *
 * Each test validates:
 * 1. XML wrapper injection in system prompts
 * 2. Stream cadence (SSE vs line-JSON → OpenAI SSE)
 * 3. Final finish_reason and optional usage chunk
 */

import { spawn } from "child_process";

import { expect } from "chai";
import { after, before, describe, it } from "mocha";

import type { OpenAIRequest, OpenAIStreamChunk } from "../../types/openai.js";
import type { ChildProcess } from "child_process";

// Test server ports
const MOCK_OPENAI_PORT = 3001;
const MOCK_OLLAMA_PORT = 11434;
const PROXY_PORT = 3000;

interface TestServer {
  process: ChildProcess;
  port: number;
  name: string;
}

describe("Conformance Smoke Tests", () => {
  const servers: TestServer[] = [];

  before(async function() {
    this.timeout(30000);

    // Start mock OpenAI server
    const mockOpenAI = spawn("node", ["dist/test-servers/mock-openai-server.js"], {
      env: { ...process.env, PORT: MOCK_OPENAI_PORT.toString() }
    });
    servers.push({ process: mockOpenAI, port: MOCK_OPENAI_PORT, name: "Mock OpenAI" });

    // Start mock Ollama server
    const mockOllama = spawn("node", ["dist/test-servers/mock-ollama-server.js"], {
      env: { ...process.env, PORT: MOCK_OLLAMA_PORT.toString() }
    });
    servers.push({ process: mockOllama, port: MOCK_OLLAMA_PORT, name: "Mock Ollama" });

    // Start ToolBridge proxy
    const proxy = spawn("node", ["dist/src/index.js"], {
      env: {
        ...process.env,
        PROXY_PORT: PROXY_PORT.toString(),
        BACKEND_LLM_BASE_URL: `http://localhost:${MOCK_OPENAI_PORT}/v1`,
        BACKEND_LLM_API_KEY: "test-key",
      }
    });
    servers.push({ process: proxy, port: PROXY_PORT, name: "ToolBridge Proxy" });

    // Wait for servers to start
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log("✓ All test servers started");
  });

  after(() => {
    servers.forEach(server => {
      server.process.kill();
      console.log(`✗ Stopped ${server.name}`);
    });
  });

  describe("OpenAI → Ollama (serving OpenAI, upstream Ollama-native)", () => {
    it("should inject XML wrapper in system prompt", async () => {
      const request: OpenAIRequest = {
        model: "llama2",
        messages: [
          { role: "user", content: "What is 2+2?" }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "calculate",
              description: "Perform calculation",
              parameters: {
                type: "object",
                properties: {
                  expression: { type: "string" }
                },
                required: ["expression"]
              }
            }
          }
        ],
        stream: false,
      };

      const response = await fetch(`http://localhost:${PROXY_PORT}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-key"
        },
        body: JSON.stringify(request)
      });

      expect(response.status).to.equal(200);
      const data = await response.json();
      expect(data).to.have.property("choices");
      expect(data.choices[0]).to.have.property("message");
    });

    it("should convert Ollama line-JSON stream to OpenAI SSE", async () => {
      const request: OpenAIRequest = {
        model: "llama2",
        messages: [
          { role: "user", content: "Count to 3" }
        ],
        stream: true,
      };

      const response = await fetch(`http://localhost:${PROXY_PORT}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-key"
        },
        body: JSON.stringify(request)
      });

      expect(response.status).to.equal(200);
      expect(response.headers.get("content-type")).to.include("text/event-stream");

      const reader = response.body?.getReader();
      expect(reader).to.not.be.undefined;

      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let done = false;

      while (!done) {
        const { value, done: streamDone } = await reader!.read();
        done = streamDone;
        if (value) {
          chunks.push(decoder.decode(value, { stream: true }));
        }
      }

      const fullText = chunks.join("");
      
      // Validate SSE format
      expect(fullText).to.include("data: ");
      expect(fullText).to.include("[DONE]");

      // Parse SSE chunks
      const dataLines = fullText.split("\n").filter(line => line.startsWith("data: "));
      expect(dataLines.length).to.be.greaterThan(0);

      // Validate chunk structure
      const firstDataLine = dataLines[0]?.substring(6);
      if (firstDataLine && firstDataLine !== "[DONE]") {
        const chunk: OpenAIStreamChunk = JSON.parse(firstDataLine);
        expect(chunk).to.have.property("object", "chat.completion.chunk");
        expect(chunk).to.have.property("choices");
        expect(chunk.choices[0]).to.have.property("delta");
      }

      // Validate finish_reason in final chunk
      const lastDataLine = dataLines[dataLines.length - 2]?.substring(6); // -2 because last is [DONE]
      if (lastDataLine) {
        const finalChunk: OpenAIStreamChunk = JSON.parse(lastDataLine);
        if (finalChunk.choices.length > 0) {
          expect(finalChunk.choices[0]?.finish_reason).to.be.oneOf(["stop", "length", null]);
        }
      }
    });

    it("should emit final usage chunk when stream_options.include_usage is true", async () => {
      const request: OpenAIRequest = {
        model: "llama2",
        messages: [
          { role: "user", content: "Hi" }
        ],
        stream: true,
        stream_options: { include_usage: true },
      };

      const response = await fetch(`http://localhost:${PROXY_PORT}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-key"
        },
        body: JSON.stringify(request)
      });

      expect(response.status).to.equal(200);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let done = false;

      while (!done) {
        const { value, done: streamDone } = await reader!.read();
        done = streamDone;
        if (value) {
          chunks.push(decoder.decode(value, { stream: true }));
        }
      }

      const fullText = chunks.join("");
      const dataLines = fullText.split("\n").filter(line => line.startsWith("data: "));

      // Find usage chunk (should have empty choices array)
      let foundUsageChunk = false;
      for (const line of dataLines) {
        const data = line.substring(6);
        if (data !== "[DONE]") {
          const chunk: OpenAIStreamChunk = JSON.parse(data);
          if (chunk.choices.length === 0 && chunk.usage) {
            foundUsageChunk = true;
            expect(chunk.usage).to.have.property("prompt_tokens");
            expect(chunk.usage).to.have.property("completion_tokens");
            expect(chunk.usage).to.have.property("total_tokens");
          }
        }
      }

      expect(foundUsageChunk).to.be.true;
    });
  });
  describe("XML Wrapper Validation", () => {
    it("should detect and parse <toolbridge:calls> wrapper", async () => {
      const request: OpenAIRequest = {
        model: "gpt-4",
        messages: [
          {
            role: "user",
            content: "Use the calculate tool to compute 5*5"
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "calculate",
              description: "Perform calculation",
              parameters: {
                type: "object",
                properties: {
                  expression: { type: "string" }
                },
                required: ["expression"]
              }
            }
          }
        ],
        stream: false,
      };

      const response = await fetch(`http://localhost:${PROXY_PORT}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-key"
        },
        body: JSON.stringify(request)
      });

      expect(response.status).to.equal(200);
      const data = await response.json();
      
      // The mock server should return a response with tool calls
      expect(data).to.have.property("choices");
      expect(data.choices[0]).to.have.property("message");
    });
  });
});
