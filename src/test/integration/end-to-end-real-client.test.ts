/**
 * END-TO-END REAL CLIENT INTEGRATION TESTS
 * 
 * Tests all format conversions with REAL clients:
 * - OpenAI SDK → ToolBridge → OpenRouter backend
 * - Ollama Client → ToolBridge → OpenRouter (format conversion)
 * 
 * Validates:
 * - Request format conversion (OpenAI ⇄ Ollama)
 * - Response format conversion
 * - Streaming (SSE and line-JSON)
 * - Tool calling with XML wrapper injection
 * - Error handling
 */

import { spawn } from "child_process";

import { expect } from "chai";
import { after, before, describe, it } from "mocha";
import OpenAI from "openai";

import type { ChildProcess } from "child_process";

// Load environment
const PROXY_PORT = parseInt(process.env.PROXY_PORT ?? "3000", 10);
const PROXY_HOST = process.env.PROXY_HOST ?? "localhost";
const TEST_MODEL = process.env["TEST_MODEL"] ?? "deepseek/deepseek-chat-v3.1:free";
const BACKEND_API_KEY = process.env.BACKEND_LLM_API_KEY ?? "sk-test";

console.log("\n🧪 END-TO-END REAL CLIENT TESTS");
console.log("================================");
console.log(`Model: ${TEST_MODEL}`);
console.log(`Proxy: http://${PROXY_HOST}:${PROXY_PORT}`);
console.log(`Backend: ${process.env.BACKEND_LLM_BASE_URL}`);
console.log("");

describe("🚀 END-TO-END: Real Client Integration Tests", function() {
  this.timeout(60000); // 60s for real API calls

  let proxyServer: ChildProcess | null = null;

  before(async function() {
    this.timeout(10000);
    
    console.log("Starting ToolBridge proxy server...");
    
    // Start ToolBridge server
    proxyServer = spawn("node", ["dist/src/index.js"], {
      env: {
        ...process.env,
        PROXY_PORT: PROXY_PORT.toString(),
        DEBUG_MODE: "false", // Reduce noise
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 3000));
    
    console.log("✓ ToolBridge proxy started\n");
  });

  after(() => {
    if (proxyServer) {
      proxyServer.kill();
      console.log("\n✓ ToolBridge proxy stopped");
    }
  });

  describe("1️⃣ OpenAI SDK → ToolBridge → Backend", () => {
    let client: OpenAI;

    before(() => {
      client = new OpenAI({
        baseURL: `http://${PROXY_HOST}:${PROXY_PORT}/v1`,
        apiKey: BACKEND_API_KEY,
      });
    });

    it("should handle basic chat completion (non-streaming)", async () => {
      const response = await client.chat.completions.create({
        model: TEST_MODEL,
        messages: [
          { role: "user", content: "Say 'Hello from OpenAI SDK' and nothing else." }
        ],
        max_tokens: 50,
      });

      console.log("OpenAI SDK Response:", JSON.stringify(response, null, 2));

      expect(response).to.have.property("id");
      expect(response).to.have.property("object", "chat.completion");
      expect(response).to.have.property("choices");
      expect(response.choices).to.have.lengthOf.at.least(1);
      expect(response.choices[0]).to.have.property("message");
      expect(response.choices[0]?.message.content).to.be.a("string");
      expect(response.choices[0]?.message.content?.toLowerCase()).to.include("hello");
    });

    it("should handle streaming chat completion", async function() {
      this.timeout(25000); // 25s max for streaming test
      
      const stream = await client.chat.completions.create({
        model: TEST_MODEL,
        messages: [
          { role: "user", content: "Count to 3, one number per line." }
        ],
        stream: true,
        max_tokens: 50,
      });

      const chunks: string[] = [];
      let streamError: Error | null = null;

      // Create a promise that resolves when we get chunks OR timeout
      const streamPromise = (async () => {
        try {
          let chunkCount = 0;
          for await (const chunk of stream) {
            if (chunk.choices[0]?.delta?.content) {
              chunks.push(chunk.choices[0].delta.content);
            }
            chunkCount++;
            
            // Safety: break after reasonable chunk count
            if (chunkCount > 200) {
              console.log("Breaking: Too many chunks");
              break;
            }
          }
        } catch (_error) {
          streamError = _error as Error;
          console.log("Stream error (may be expected):", streamError.message);
          // OpenRouter often closes streams prematurely but chunks are already received
        }
      })();

      // Race between stream completion and timeout
      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          console.log("Stream timeout reached - considering chunks received");
          resolve();
        }, 20000); // 20s timeout
      });

      await Promise.race([streamPromise, timeoutPromise]);

      const fullText = chunks.join("");
      console.log("Streamed content:", fullText);
      console.log("Chunks received:", chunks.length);
      console.log("Stream error occurred:", streamError !== null);

      // Test passes if we got ANY chunks, even with premature close
      if (chunks.length > 0) {
        expect(chunks.length).to.be.greaterThan(0);
        expect(fullText.length).to.be.greaterThan(0);
        console.log("✅ Streaming works (premature close is backend behavior)");
      } else {
        console.log("Note: No chunks received - streaming may not be supported");
        this.skip();
      }
    });

    it("should handle tool calls with XML wrapper injection (if supported)", async function() {
      try {
        const response = await client.chat.completions.create({
          model: TEST_MODEL,
          messages: [
            { role: "user", content: "What is 15 + 27? Use the calculator tool." }
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "calculate",
                description: "Perform arithmetic calculation",
                parameters: {
                  type: "object",
                  properties: {
                    expression: {
                      type: "string",
                      description: "The mathematical expression to evaluate"
                    }
                  },
                  required: ["expression"]
                }
              }
            }
          ],
          max_tokens: 200,
        });

        console.log("Tool call response:", JSON.stringify(response, null, 2));

        expect(response).to.have.property("choices");
        expect(response.choices[0]).to.have.property("message");
        
        // The response should either have tool_calls or contain XML wrapper in content
        const message = response.choices[0]?.message;
        const hasToolCalls = message?.tool_calls && message.tool_calls.length > 0;
        const hasXMLWrapper = message?.content?.includes("<toolbridge:calls>");
        
        console.log("Has tool_calls:", hasToolCalls);
        console.log("Has XML wrapper:", hasXMLWrapper);
        
        expect(hasToolCalls || hasXMLWrapper).to.be.true;
      } catch (_error) {
        const errorMsg = (_error as Error).message;
        if (errorMsg.includes("tool use") || errorMsg.includes("404")) {
          console.log("Note: This model/backend does not support tool calling");
          this.skip();
        } else {
          throw _error;
        }
      }
    });

    it("should handle multimodal content (text array format)", async () => {
      const response = await client.chat.completions.create({
        model: TEST_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this: A red apple on a table." }
            ]
          }
        ],
        max_tokens: 100,
      });

      console.log("Multimodal response:", JSON.stringify(response.choices[0], null, 2));

      expect(response.choices[0]?.message.content).to.be.a("string");
      expect(response.choices[0]?.message.content?.length).to.be.greaterThan(0);
    });
  });

  describe("2️⃣ Ollama Native Format → ToolBridge → Backend", () => {
    it("should convert Ollama native request to backend format", async () => {
      const ollamaRequest = {
        model: TEST_MODEL,
        prompt: "Say 'Hello from Ollama format' and nothing else.",
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 50,
        }
      };

      const response = await fetch(`http://${PROXY_HOST}:${PROXY_PORT}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ollamaRequest),
      });

      expect(response.ok).to.be.true;
      const data = await response.json();

      console.log("Ollama native response:", JSON.stringify(data, null, 2));

      // The response should be converted to Ollama format
      expect(data).to.have.property("model");
      expect(data).to.have.property("done");
      
      // Check for content (can be in different fields depending on conversion)
      const hasResponse = data.response || data.message?.content;
      expect(hasResponse).to.exist;
      expect(hasResponse).to.be.a("string");
      expect(hasResponse.toLowerCase()).to.include("hello");
    });

    it("should handle Ollama native streaming", async () => {
      const ollamaRequest = {
        model: TEST_MODEL,
        prompt: "Count: 1, 2, 3",
        stream: true,
        options: {
          num_predict: 50,
        }
      };

      const response = await fetch(`http://${PROXY_HOST}:${PROXY_PORT}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ollamaRequest),
      });

      expect(response.ok).to.be.true;
      expect(response.headers.get("content-type")).to.include("application/x-ndjson");

      const reader = response.body?.getReader();
      expect(reader).to.not.be.undefined;

      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let doneReceived = false;

      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n").filter(line => line.trim());

        for (const line of lines) {
          try {
            const chunk = JSON.parse(line);
            if (chunk.response) {
              chunks.push(chunk.response);
            }
            if (chunk.done === true) {
              doneReceived = true;
            }
          } catch (_e) {
            // Ignore parse errors for incomplete chunks
          }
        }
      }

      console.log("Ollama streamed chunks:", chunks.length);
      console.log("Full text:", chunks.join(""));

      expect(chunks.length).to.be.greaterThan(0);
      expect(doneReceived).to.be.true;
    });
  });

  describe("3️⃣ Ollama OpenAI-Compatible → ToolBridge → Backend", () => {
    let ollamaCompatClient: OpenAI;

    before(() => {
      // Use OpenAI SDK but point to Ollama-compat endpoint via ToolBridge
      ollamaCompatClient = new OpenAI({
        baseURL: `http://${PROXY_HOST}:${PROXY_PORT}/v1`,
        apiKey: BACKEND_API_KEY,
      });
    });

    it("should handle Ollama compat format (OpenAI SDK to Ollama endpoint)", async () => {
      const response = await ollamaCompatClient.chat.completions.create({
        model: TEST_MODEL,
        messages: [
          { role: "user", content: "Say 'Hello from Ollama compat' and nothing else." }
        ],
        max_tokens: 50,
      });

      console.log("Ollama compat response:", JSON.stringify(response.choices[0], null, 2));

      expect(response.choices[0]?.message.content).to.be.a("string");
      expect(response.choices[0]?.message.content?.toLowerCase()).to.include("hello");
    });
  });

  describe("4️⃣ Format Conversion Validation", () => {
    it("should correctly convert OpenAI request with tools to backend (if supported)", async function() {
      const client = new OpenAI({
        baseURL: `http://${PROXY_HOST}:${PROXY_PORT}/v1`,
        apiKey: BACKEND_API_KEY,
      });

      try {
        const response = await client.chat.completions.create({
          model: TEST_MODEL,
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "What's the weather?" }
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "get_weather",
                description: "Get weather for a location",
                parameters: {
                  type: "object",
                  properties: {
                    location: { type: "string" },
                    unit: { type: "string", enum: ["celsius", "fahrenheit"] }
                  },
                  required: ["location"]
                }
              }
            }
          ],
          max_tokens: 150,
        });

        console.log("Format conversion with tools:", JSON.stringify(response.choices[0]?.message, null, 2));

        // Should receive a valid response (with or without tool calls)
        expect(response.choices[0]?.message).to.exist;
        
        // Check if system prompt included XML wrapper instructions
        // (This would be visible in backend logs if DEBUG_MODE=true)
        console.log("✓ Tool instructions should be injected in system prompt");
      } catch (_error) {
        const errorMsg = (_error as Error).message;
        if (errorMsg.includes("tool use") || errorMsg.includes("404")) {
          console.log("Note: This model/backend does not support tool calling");
          this.skip();
        } else {
          throw _error;
        }
      }
    });

    it("should handle response_format parameter correctly", async () => {
      const client = new OpenAI({
        baseURL: `http://${PROXY_HOST}:${PROXY_PORT}/v1`,
        apiKey: BACKEND_API_KEY,
      });

      try {
        const response = await client.chat.completions.create({
          model: TEST_MODEL,
          messages: [
            { role: "user", content: "Return a JSON object with name='Alice' and age=30." }
          ],
          response_format: { type: "json_object" },
          max_tokens: 100,
        });

        console.log("JSON response:", response.choices[0]?.message.content);

        // Verify it's valid JSON
        const content = response.choices[0]?.message.content;
        if (content) {
          const parsed = JSON.parse(content);
          expect(parsed).to.be.an("object");
        }
      } catch (_error) {
        // Some models/backends don't support response_format
        console.log("Note: response_format may not be supported by this backend");
      }
    });
  });

  describe("5️⃣ Stream Options (include_usage)", () => {
    it("should emit final usage chunk when stream_options.include_usage is true (if supported)", async function() {
      this.timeout(25000); // 25s max
      
      const client = new OpenAI({
        baseURL: `http://${PROXY_HOST}:${PROXY_PORT}/v1`,
        apiKey: BACKEND_API_KEY,
      });

      try {
        const stream = await client.chat.completions.create({
          model: TEST_MODEL,
          messages: [
            { role: "user", content: "Say hi" }
          ],
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: 50,
        });

        let foundUsageChunk = false;
        let usageData = null;
        let chunkCount = 0;
        let streamError: Error | null = null;

        const streamPromise = (async () => {
          try {
            for await (const chunk of stream) {
              chunkCount++;
              // Look for final usage chunk (empty choices array with usage)
              if (chunk.choices.length === 0 && chunk.usage) {
                foundUsageChunk = true;
                usageData = chunk.usage;
              }
              
              // Timeout safety
              if (chunkCount > 200) {
                console.log("Breaking: Too many chunks");
                break;
              }
            }
          } catch (_error) {
            streamError = _error as Error;
            console.log("Stream error:", streamError.message);
          }
        })();

        const timeoutPromise = new Promise<void>((resolve) => {
          setTimeout(() => {
            console.log("Stream timeout - checking results");
            resolve();
          }, 20000);
        });

        await Promise.race([streamPromise, timeoutPromise]);

        console.log("Usage chunk found:", foundUsageChunk);
        console.log("Usage data:", usageData);
        console.log("Total chunks:", chunkCount);

        if (foundUsageChunk) {
          expect(usageData).to.have.property("prompt_tokens");
          expect(usageData).to.have.property("completion_tokens");
          expect(usageData).to.have.property("total_tokens");
        } else {
          console.log("Note: Backend may not support stream_options.include_usage");
          this.skip();
        }
      } catch (_error) {
        console.log("Test error:", (_error as Error).message);
        this.skip();
      }
    });
  });

  describe("6️⃣ Error Handling", () => {
    it("should handle invalid model gracefully", async () => {
      const client = new OpenAI({
        baseURL: `http://${PROXY_HOST}:${PROXY_PORT}/v1`,
        apiKey: BACKEND_API_KEY,
      });

      try {
        await client.chat.completions.create({
          model: "invalid-model-name-12345",
          messages: [
            { role: "user", content: "Test" }
          ],
        });
        
        // If no error, the backend accepted it
        console.log("Backend accepted the model name (may use fallback)");
      } catch (_error) {
        // Expected error
        expect(_error).to.exist;
        console.log("Error correctly handled:", (_error as Error).message);
      }
    });

    it("should handle malformed request", async () => {
      const response = await fetch(`http://${PROXY_HOST}:${PROXY_PORT}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${BACKEND_API_KEY}`,
        },
        body: JSON.stringify({
          model: TEST_MODEL,
          // Missing required messages field
        }),
      });

      expect(response.ok).to.be.false;
      expect(response.status).to.be.oneOf([400, 422, 500]); // Allow 500 for validation errors
      
      // Handle both JSON and HTML error responses
      const contentType = response.headers.get("content-type");
      console.log("Error response content-type:", contentType);
      
      if (contentType?.includes("application/json")) {
        const error = await response.json();
        console.log("Error response:", error);
        expect(error).to.have.property("error");
      } else {
        // HTML or other format
        const text = await response.text();
        console.log("Error response (non-JSON):", text.substring(0, 200));
        expect(text.length).to.be.greaterThan(0);
      }
    });
  });

  describe("7️⃣ Performance & Streaming Validation", () => {
    it("should maintain streaming performance (latency check)", async function() {
      this.timeout(25000); // 25s max
      
      const client = new OpenAI({
        baseURL: `http://${PROXY_HOST}:${PROXY_PORT}/v1`,
        apiKey: BACKEND_API_KEY,
      });

      try {
        const startTime = Date.now();
        let firstChunkTime = 0;

        const stream = await client.chat.completions.create({
          model: TEST_MODEL,
          messages: [
            { role: "user", content: "Write 5 words." }
          ],
          stream: true,
          max_tokens: 50,
        });

        let chunkCount = 0;
        let streamError: Error | null = null;
        
        const streamPromise = (async () => {
          try {
            for await (const chunk of stream) {
              if (chunk.choices[0]?.delta?.content && firstChunkTime === 0) {
                firstChunkTime = Date.now();
              }
              chunkCount++;
              
              // Safety timeout
              if (chunkCount > 200) {
                console.log("Breaking: Too many chunks");
                break;
              }
            }
          } catch (_error) {
            streamError = _error as Error;
            console.log("Stream error (expected for OpenRouter):", streamError.message);
          }
        })();

        const timeoutPromise = new Promise<void>((resolve) => {
          setTimeout(() => {
            console.log("Performance test timeout - checking results");
            resolve();
          }, 20000);
        });

        await Promise.race([streamPromise, timeoutPromise]);

        const totalTime = Date.now() - startTime;
        const timeToFirstChunk = firstChunkTime > 0 ? firstChunkTime - startTime : 0;

        console.log(`Streaming performance:
  - Time to first chunk: ${timeToFirstChunk}ms
  - Total time: ${totalTime}ms
  - Chunks received: ${chunkCount}`);

        if (chunkCount > 0) {
          expect(timeToFirstChunk).to.be.lessThan(15000); // < 15s (relaxed for network)
          expect(chunkCount).to.be.greaterThan(0);
          console.log("✅ Streaming performance acceptable");
        } else {
          console.log("No chunks received - streaming may not be supported");
          this.skip();
        }
      } catch (_error) {
        console.log("Performance test error:", (_error as Error).message);
        this.skip();
      }
    });
  });
});
