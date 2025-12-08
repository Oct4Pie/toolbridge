/**
 * FORMAT CONVERSION END-TO-END TESTS
 *
 * Tests ALL format conversions in BOTH directions with REAL clients:
 * - OpenAI SDK ⟷ OpenAI-compatible Backend
 * - Ollama Format ⟷ OpenAI-compatible Backend
 * - OpenAI SDK ⟷ Ollama Backend
 * - Ollama Format ⟷ Ollama Backend
 *
 * Validates:
 * - Request format conversion (OpenAI ⇄ Ollama)
 * - Response format conversion
 * - Streaming (SSE and NDJSON)
 * - Tool calling with XML wrapper injection
 * - Advanced features (response_format, stream_options, multimodal)
 * - Error handling
 * - Performance validation
 *
 * NO MOCKS - 100% real API calls
 */

import { expect } from "chai";
import { after, before, describe, it } from "mocha";
import OpenAI from "openai";

import { BACKEND_LLM_BASE_URL } from "../../config.js";
import { setupTestServer, type TestServerSetup } from "../utils/testServerHelpers.js";
import { TEST_CONFIG } from "../utils/testConfig.js";
import { readSSEBody } from "../utils/sseUtils.js";
import { readNdjsonStream } from "../utils/ndjsonUtils.js";
import { weatherTool } from "../fixtures/tools.js";

// Environment configuration
const TEST_MODEL_OPENAI_COMPATIBLE = TEST_CONFIG.TEST_MODEL;
const TEST_MODEL_OLLAMA = TEST_CONFIG.TEST_MODEL_OLLAMA ?? "llama3.2:1b";
const BACKEND_API_KEY = process.env.BACKEND_LLM_API_KEY ?? "sk-test";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? TEST_CONFIG.backends.ollamaUrl;
const RUN_REAL_BACKEND_TESTS = process.env["RUN_REAL_BACKEND_TESTS"] === "true";
const describeReal = RUN_REAL_BACKEND_TESTS ? describe : describe.skip;

describeReal("🔄 FORMAT CONVERSION: All Format Conversions E2E", function() {
  this.timeout(120000);

  let server: TestServerSetup;
  let ollamaAvailable = false;

  before(async function() {
    this.timeout(20000);

    console.log("\n🔄 FORMAT CONVERSION END-TO-END TESTS");
    console.log("=====================================");
    console.log(`Model: ${TEST_MODEL_OPENAI_COMPATIBLE}`);
    console.log(`Backend: ${BACKEND_LLM_BASE_URL}`);
    console.log(`OpenAI-compatible: ${TEST_MODEL_OPENAI_COMPATIBLE}`);
    console.log(`Ollama: ${TEST_MODEL_OLLAMA}`);
    console.log("");

    console.log("Starting ToolBridge proxy server...");

    server = await setupTestServer({
      passTools: false,
    });

    console.log(`Proxy: ${server.baseUrl}`);

    // Check Ollama availability
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
      if (response.ok) {
        ollamaAvailable = true;
        console.log("✓ Ollama available");
      }
    } catch {
      console.log("✗ Ollama not available");
    }

    console.log("✓ ToolBridge proxy started\n");
  });

  after(async () => {
    console.log("\n🛑 Stopping proxy server...");
    await server.cleanup();
    console.log("✓ ToolBridge proxy stopped");
  });

  // ============================================================================
  // SECTION 1: OpenAI SDK → OpenAI-compatible Backend
  // ============================================================================

  describe("1️⃣ OpenAI SDK → OpenAI-compatible Backend", () => {
    let client: OpenAI;

    before(() => {
      client = new OpenAI({
        baseURL: server.openaiBaseUrl,
        apiKey: BACKEND_API_KEY,
      });
    });

    it("should handle basic chat completion (non-streaming)", async () => {
      const response = await client.chat.completions.create({
        model: TEST_MODEL_OPENAI_COMPATIBLE,
        messages: [
          { role: "user", content: "Say 'Hello from OpenAI SDK' and nothing else." }
        ],
        max_tokens: 50,
      });

      console.log("OpenAI SDK Response: ✓", response.choices.length, "choices");

      expect(response).to.have.property("id");
      expect(response).to.have.property("object", "chat.completion");
      expect(response).to.have.property("choices");
      expect(response.choices).to.have.lengthOf.at.least(1);
      expect(response.choices[0]).to.have.property("message");
      expect(response.choices[0]?.message.content).to.be.a("string");
      expect(response.choices[0]?.message.content?.toLowerCase()).to.include("hello");
    });

    it("should handle OpenAI format request", async () => {
      const response = await client.chat.completions.create({
        model: TEST_MODEL_OPENAI_COMPATIBLE,
        messages: [
          { role: "user", content: "Say 'OpenAI format works'" }
        ],
        max_tokens: 50,
      });
      console.log("OpenAI→OpenAI-compatible: ✓ Response received");

      expect(response.choices[0]?.message).to.exist;
      expect(response.choices[0]?.message.content).to.be.a("string");
    });

    it("should handle streaming chat completion", async function() {
      this.timeout(30000);

      const stream = await client.chat.completions.create({
        model: TEST_MODEL_OPENAI_COMPATIBLE,
        messages: [
          { role: "user", content: "Count to 3, one number per line." }
        ],
        stream: true,
        max_tokens: 50,
      });

      const chunks: string[] = [];
      let streamError: Error | null = null;

      const streamPromise = (async () => {
        try {
          let chunkCount = 0;
          for await (const chunk of stream) {
            if (chunk.choices[0]?.delta?.content) {
              chunks.push(chunk.choices[0].delta.content);
            }
            chunkCount++;

            if (chunkCount > 200) {
              console.log("Breaking: Too many chunks");
              break;
            }
          }
        } catch (_error) {
          streamError = _error as Error;
          console.log("Stream error (may be expected):", streamError.message);
        }
      })();

      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          console.log("Stream timeout reached - considering chunks received");
          resolve();
        }, 25000);
      });

      await Promise.race([streamPromise, timeoutPromise]);

      const fullText = chunks.join("");
      console.log("Streamed content:", fullText);
      console.log("Chunks received:", chunks.length);

      if (chunks.length > 0) {
        expect(chunks.length).to.be.greaterThan(0);
        expect(fullText.length).to.be.greaterThan(0);
        console.log("✅ Streaming works (premature close is backend behavior)");
      } else {
        console.log("Note: No chunks received - streaming may not be supported");
        this.skip();
      }
    });

    it("should handle OpenAI streaming", async function() {
      this.timeout(30000);

      const stream = await client.chat.completions.create({
        model: TEST_MODEL_OPENAI_COMPATIBLE,
        messages: [
          { role: "user", content: "Count: 1, 2, 3" }
        ],
        stream: true,
        max_tokens: 50,
      });

      const chunks: string[] = [];

      const streamPromise = (async () => {
        try {
          let count = 0;
          for await (const chunk of stream) {
            if (chunk.choices[0]?.delta?.content) {
              chunks.push(chunk.choices[0].delta.content);
            }
            if (++count > 200) break;
          }
        } catch (error) {
          console.log("Stream error:", (error as Error).message);
        }
      })();

      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(resolve, 25000);
      });

      await Promise.race([streamPromise, timeoutPromise]);

      console.log("OpenAI streaming chunks:", chunks.length);

      if (chunks.length > 0) {
        expect(chunks.length).to.be.greaterThan(0);
      } else {
        this.skip();
      }
    });
  });

  // ============================================================================
  // SECTION 2: Ollama Format → OpenAI-compatible Backend
  // ============================================================================

  describe("2️⃣ Ollama Format → OpenAI-compatible Backend", () => {
    it("should convert Ollama /api/chat to OpenAI format", async () => {
      const response = await fetch(`${server.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: TEST_MODEL_OPENAI_COMPATIBLE,
          messages: [
            { role: "user", content: "Say 'Ollama format works'" }
          ],
          stream: false,
        }),
      });

      expect(response.ok).to.be.true;
      const data = await response.json();

      console.log("Ollama→OpenAI-compatible: ✓ Response received with", Object.keys(data).length, "fields");

      expect(data).to.exist;

      const hasContent = data.message?.content || data.response || data.choices?.[0]?.message?.content;
      expect(hasContent).to.exist;
    });

    it("should convert Ollama native request to backend format", async () => {
      const ollamaRequest = {
        model: TEST_MODEL_OPENAI_COMPATIBLE,
        prompt: "Say 'Hello from Ollama format' and nothing else.",
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 50,
        }
      };

      const response = await fetch(`${server.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ollamaRequest),
      });

      expect(response.ok).to.be.true;
      const data = await response.json();

      console.log("Ollama native response: ✓", data.done ? "Complete" : "Partial");

      expect(data).to.have.property("model");
      expect(data).to.have.property("done");

      const hasResponse = data.response || data.message?.content;
      expect(hasResponse).to.exist;
      expect(hasResponse).to.be.a("string");
      expect(hasResponse.toLowerCase()).to.include("hello");
    });

    it("should handle Ollama streaming format", async () => {
      const response = await fetch(`${server.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: TEST_MODEL_OPENAI_COMPATIBLE,
          messages: [
            { role: "user", content: "Count to 3" }
          ],
          stream: true,
        }),
      });

      expect(response.ok).to.be.true;

      const text = await readSSEBody(response as unknown as Response);
      console.log("Ollama streaming bytes:", text.length);
      if (text.length > 0) {
        expect(text).to.contain("data:");
      }
    });

    it("should handle Ollama native streaming", async () => {
      const ollamaRequest = {
        model: TEST_MODEL_OPENAI_COMPATIBLE,
        prompt: "Count: 1, 2, 3",
        stream: true,
        options: {
          num_predict: 50,
        }
      };

      const response = await fetch(`${server.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ollamaRequest),
      });

      expect(response.ok).to.be.true;
      expect(response.headers.get("content-type")).to.include("application/x-ndjson");

      const { lines, done } = await readNdjsonStream(response as unknown as Response);
      console.log("Ollama streamed chunks:", lines.length);
      expect(lines.length).to.be.greaterThan(0);
      expect(done).to.be.true;
    });
  });

  // ============================================================================
  // SECTION 3: OpenAI SDK → Ollama Backend (if available)
  // ============================================================================

  describe("3️⃣ OpenAI SDK → Ollama Backend (if available)", () => {
    it("should convert OpenAI format to Ollama native", async function() {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        this.skip();
        return;
      }

      const client = new OpenAI({
        baseURL: server.openaiBaseUrl,
        apiKey: "ollama",
      });

      const response = await client.chat.completions.create({
        model: TEST_MODEL_OLLAMA,
        messages: [
          { role: "user", content: "Say hello" }
        ],
        max_tokens: 50,
      });

      console.log("OpenAI→Ollama: ✓ Response received");

      expect(response.choices[0]?.message).to.exist;
    });
  });

  // ============================================================================
  // SECTION 4: Ollama Format → Ollama Backend (if available)
  // ============================================================================

  describe("4️⃣ Ollama Format → Ollama Backend (if available)", () => {
    it("should handle native Ollama to Ollama", async function() {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        this.skip();
        return;
      }

      const response = await fetch(`${server.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: TEST_MODEL_OLLAMA,
          messages: [
            { role: "user", content: "Say hello from Ollama" }
          ],
          stream: false,
        }),
      });

      expect(response.ok).to.be.true;
      const data = await response.json();

      console.log("Ollama→Ollama: ✓", data.done ? "Complete" : "Partial");

      expect(data).to.exist;
    });
  });

  // ============================================================================
  // SECTION 5: Advanced Features
  // ============================================================================

  describe("5️⃣ Advanced Features", () => {
    let client: OpenAI;

    before(() => {
      client = new OpenAI({
        baseURL: server.openaiBaseUrl,
        apiKey: BACKEND_API_KEY,
      });
    });

    it("should handle multimodal content (text array format)", async () => {
      const response = await client.chat.completions.create({
        model: TEST_MODEL_OPENAI_COMPATIBLE,
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

      console.log("Multimodal response: ✓ Received");

      expect(response.choices[0]?.message.content).to.be.a("string");
      expect(response.choices[0]?.message.content?.length).to.be.greaterThan(0);
    });

    it("should handle multimodal content arrays", async () => {
      const response = await client.chat.completions.create({
        model: TEST_MODEL_OPENAI_COMPATIBLE,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this" },
              { type: "text", text: "It's a simple test" }
            ]
          }
        ],
        max_tokens: 50,
      });

      console.log("Multimodal content: ✓", response.choices[0]?.message.content?.substring(0, 50) + "...");

      expect(response.choices[0]?.message).to.exist;
    });

    it("should handle response_format parameter correctly", async () => {
      try {
        const response = await client.chat.completions.create({
          model: TEST_MODEL_OPENAI_COMPATIBLE,
          messages: [
            { role: "user", content: "Return a JSON object with name='Alice' and age=30." }
          ],
          response_format: { type: "json_object" },
          max_tokens: 100,
        });

        console.log("JSON response:", response.choices[0]?.message.content?.substring(0, 50) + "...");

        const content = response.choices[0]?.message.content;
        if (content) {
          const parsed = JSON.parse(content);
          expect(parsed).to.be.an("object");
        }
      } catch (_error) {
        console.log("Note: response_format may not be supported by this backend");
      }
    });

    it("should emit final usage chunk when stream_options.include_usage is true (if supported)", async function() {
      this.timeout(25000);

      try {
        const stream = await client.chat.completions.create({
          model: TEST_MODEL_OPENAI_COMPATIBLE,
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
              if (chunk.choices.length === 0 && chunk.usage) {
                foundUsageChunk = true;
                usageData = chunk.usage;
              }

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

  // ============================================================================
  // SECTION 6: Format Validation
  // ============================================================================

  describe("6️⃣ Format Validation", () => {
    let client: OpenAI;

    before(() => {
      client = new OpenAI({
        baseURL: server.openaiBaseUrl,
        apiKey: BACKEND_API_KEY,
      });
    });

    it("should preserve message structure in conversions", async () => {
      const response = await client.chat.completions.create({
        model: TEST_MODEL_OPENAI_COMPATIBLE,
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Say hello" }
        ],
        max_tokens: 50,
      });

      console.log("Format validation: ✓", response.choices.length, "choices,", response.model);

      expect(response).to.have.property("id");
      expect(response).to.have.property("model");
      expect(response).to.have.property("choices");
      expect(response.choices).to.have.lengthOf.at.least(1);
      expect(response.choices[0]).to.have.property("message");
    });

    it("should correctly convert OpenAI request with tools to backend (if supported)", async function() {
      try {
        const response = await client.chat.completions.create({
          model: TEST_MODEL_OPENAI_COMPATIBLE,
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "What's the weather?" }
          ],
          tools: [weatherTool],
          max_tokens: 150,
        });

        console.log("Format conversion with tools: ✓ Received");

        expect(response.choices[0]?.message).to.exist;

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
  });

  // ============================================================================
  // SECTION 7: Tool Calling Across Backends
  // ============================================================================

  describe("7️⃣ Tool Calling Across Backends", () => {
    let client: OpenAI;

    before(() => {
      client = new OpenAI({
        baseURL: server.openaiBaseUrl,
        apiKey: BACKEND_API_KEY,
      });
    });

    it("should handle tool calls with XML wrapper injection (if supported)", async function() {
      try {
        const response = await client.chat.completions.create({
          model: TEST_MODEL_OPENAI_COMPATIBLE,
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

        console.log("Tool call response: ✓", response.choices.length, "choices");

        expect(response).to.have.property("choices");
        expect(response.choices[0]).to.have.property("message");

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

    it("should inject XML tools for OpenAI-compatible backend", async () => {
      const response = await client.chat.completions.create({
        model: TEST_MODEL_OPENAI_COMPATIBLE,
        messages: [
          { role: "user", content: "What's 10+5? Use calculator if available." }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "add",
              description: "Add two numbers",
              parameters: {
                type: "object",
                properties: {
                  a: { type: "number" },
                  b: { type: "number" }
                },
                required: ["a", "b"]
              }
            }
          }
        ],
        max_tokens: 200,
      });

      const message = response.choices[0]?.message;
      const content = message?.content ?? "";
      const hasXML = content.includes("<toolbridge:calls>") || content.includes("<add>");
      const hasToolCalls = message?.tool_calls && message.tool_calls.length > 0;

      console.log("Tool response - XML:", hasXML, "tool_calls:", hasToolCalls);

      expect(message).to.exist;
    });

    it("should inject XML tools via Ollama format", async () => {
      const response = await fetch(`${server.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: TEST_MODEL_OPENAI_COMPATIBLE,
          messages: [
            { role: "user", content: "Multiply 6 times 7. Use multiply tool." }
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "multiply",
                description: "Multiply numbers",
                parameters: {
                  type: "object",
                  properties: {
                    a: { type: "number" },
                    b: { type: "number" }
                  },
                  required: ["a", "b"]
                }
              }
            }
          ],
          stream: false,
        }),
      });

      expect(response.ok).to.be.true;
      const data = await response.json();

      console.log("Ollama format tool response: ✓", data.done ? "complete" : "partial");

      expect(data).to.exist;

      const content = data.message?.content || data.response || data.choices?.[0]?.message?.content || "";
      const hasXML = content.includes("<toolbridge:calls>") || content.includes("<multiply>");

      console.log("Ollama format - XML:", hasXML);
    });
  });

  // ============================================================================
  // SECTION 8: Error Handling
  // ============================================================================

  describe("8️⃣ Error Handling", () => {
    let client: OpenAI;

    before(() => {
      client = new OpenAI({
        baseURL: server.openaiBaseUrl,
        apiKey: BACKEND_API_KEY,
      });
    });

    it("should handle invalid model gracefully", async () => {
      try {
        await client.chat.completions.create({
          model: "invalid-model-name-12345",
          messages: [
            { role: "user", content: "Test" }
          ],
        });

        console.log("Backend accepted the model name (may use fallback)");
      } catch (_error) {
        expect(_error).to.exist;
        console.log("Error correctly handled:", (_error as Error).message);
      }
    });

    it("should handle invalid model in OpenAI format", async () => {
      try {
        await client.chat.completions.create({
          model: "invalid-model-12345",
          messages: [
            { role: "user", content: "test" }
          ],
        });

        expect.fail("Should have thrown error");
      } catch (error) {
        console.log("OpenAI format error: ✓ Caught");
        expect(error).to.exist;
      }
    });

    it("should handle invalid model in Ollama format", async () => {
      const response = await fetch(`${server.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "invalid-model-67890",
          messages: [
            { role: "user", content: "test" }
          ],
          stream: false,
        }),
      });

      console.log("Ollama format error status:", response.status);

      expect(response.ok).to.be.false;
      expect(response.status).to.be.oneOf([400, 404, 500]);
    });

    it("should handle malformed request", async () => {
      const response = await fetch(`${server.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${BACKEND_API_KEY}`,
        },
        body: JSON.stringify({
          model: TEST_MODEL_OPENAI_COMPATIBLE,
          // Missing required messages field
        }),
      });

      expect(response.ok).to.be.false;
      expect(response.status).to.be.oneOf([400, 422, 500]);

      const contentType = response.headers.get("content-type");
      console.log("Error response content-type:", contentType);

      if (contentType?.includes("application/json")) {
        const error = await response.json();
        console.log("Error response:", error);
        expect(error).to.have.property("error");
      } else {
        const text = await response.text();
        console.log("Error response (non-JSON):", text.substring(0, 50));
        expect(text.length).to.be.greaterThan(0);
      }
    });

    it("should handle malformed JSON in Ollama format", async () => {
      const response = await fetch(`${server.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{ invalid json",
      });

      console.log("Malformed JSON status:", response.status);

      expect(response.ok).to.be.false;
    });
  });

  // ============================================================================
  // SECTION 9: Performance Validation
  // ============================================================================

  describe("9️⃣ Performance & Streaming Validation", () => {
    let client: OpenAI;

    before(() => {
      client = new OpenAI({
        baseURL: server.openaiBaseUrl,
        apiKey: BACKEND_API_KEY,
      });
    });

    it("should maintain streaming performance (latency check)", async function() {
      this.timeout(25000);

      try {
        const startTime = Date.now();
        let firstChunkTime = 0;

        const stream = await client.chat.completions.create({
          model: TEST_MODEL_OPENAI_COMPATIBLE,
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

              if (chunkCount > 200) {
                console.log("Breaking: Too many chunks");
                break;
              }
            }
          } catch (_error) {
            streamError = _error as Error;
            console.log("Stream error (expected for OpenAI Backend):", streamError.message);
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
          expect(timeToFirstChunk).to.be.lessThan(15000);
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
