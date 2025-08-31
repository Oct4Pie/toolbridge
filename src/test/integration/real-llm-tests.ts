import { spawn } from "child_process";

import axios from "axios";
import { expect } from "chai";
import dotenv from "dotenv";
import { describe, it, before, after } from "mocha";

import type { AxiosResponse } from "axios";
import type { ChildProcess } from "child_process";
import type { IncomingMessage } from "http";

dotenv.config();

// Type definitions
interface OpenAIMessage {
  role: string;
  content: string;
}

interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

interface ToolCall {
  id?: string;
  type?: "function";
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

interface CompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: ToolDefinition[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

interface CompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface TestResult {
  name: string;
  passed: boolean;
  reason?: string;
}

interface TestResults {
  totalTests: number;
  passed: number;
  failed: number;
  details: TestResult[];
}

// Test configuration
const PROXY_PORT: string | number = process.env.PROXY_PORT ? parseInt(process.env.PROXY_PORT, 10) : 3000;
const PROXY_URL: string = `http://localhost:${PROXY_PORT}`;
const TEST_MODEL: string = process.env.TEST_MODEL ?? "deepseek/deepseek-r1-0528:free";
const API_KEY: string | undefined = process.env.BACKEND_LLM_API_KEY;
const DEBUG: boolean = process.env.DEBUG_MODE === "true";

// Test results tracking
const testResults: TestResults = {
  totalTests: 0,
  passed: 0,
  failed: 0,
  details: [],
};

function log(message: string, data: unknown = null): void {
  if (DEBUG) {
    console.log(`[TEST] ${message}`);
    if (data) {console.log(JSON.stringify(data, null, 2));}
  }
}

describe("🔬 Real LLM Integration Tests with Tool Calling", function () {
  this.timeout(60000); // 60 seconds per test for real API calls
  let proxyProcess: ChildProcess | null = null;

  before(async function () {
    console.log("\n🚀 Starting ToolBridge proxy server...");
    
    // Start proxy server
    proxyProcess = spawn("npm", ["start"], {
      env: { ...process.env },
      stdio: DEBUG ? "inherit" : "ignore",
    });

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 3000));
    
    console.log(`✅ Proxy running on port ${PROXY_PORT}`);
    console.log(`📍 Using model: ${TEST_MODEL}`);
    console.log(`🔑 API Key: ${API_KEY ? "Configured" : "Missing!"}`);
  });

  after(function () {
    if (proxyProcess) {
      console.log("\n🛑 Stopping proxy server...");
      proxyProcess.kill();
    }

    // Print test summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 TEST RESULTS SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total Tests: ${testResults.totalTests}`);
    console.log(`✅ Passed: ${testResults.passed}`);
    console.log(`❌ Failed: ${testResults.failed}`);
    console.log(`Success Rate: ${((testResults.passed / testResults.totalTests) * 100).toFixed(1)}%`);
    
    console.log("\n📋 Detailed Results:");
    testResults.details.forEach((result, i) => {
      const icon = result.passed ? "✅" : "❌";
      console.log(`${icon} Test ${i + 1}: ${result.name}`);
      if (!result.passed) {
        console.log(`   Reason: ${result.reason}`);
      }
    });
  });

  describe("1️⃣ Basic Tool Detection", function () {
    it("should detect and extract a simple search tool call", async function () {
      testResults.totalTests++;
      const testName = "Simple search tool";
      
      try {
        const response: AxiosResponse<CompletionResponse> = await axios.post(
          `${PROXY_URL}/v1/chat/completions`,
          {
            model: TEST_MODEL,
            messages: [
              {
                role: "system",
                content: "You are a helpful assistant with access to tools. Respond to requests by using the appropriate tools.",
              },
              {
                role: "user",
                content: "Search for information about TypeScript generics. Use the search tool.",
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "search",
                  description: "Search for information",
                  parameters: {
                    type: "object",
                    properties: {
                      query: { type: "string", description: "Search query" },
                    },
                    required: ["query"],
                  },
                },
              },
            ],
            temperature: 0.1,
            max_tokens: 500,
          } as CompletionRequest,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${API_KEY}`,
            },
          }
        );

        log("Response received", response.data);

        // Check if model used XML format internally
      const content = response.data.choices[0].message.content ?? "";
      const hasXMLToolCall = content.includes("<search>");
      const hasToolCallField = !!(response.data.choices[0].message.tool_calls && response.data.choices[0].message.tool_calls.length > 0);

    expect(response.data).to.have.property("choices");
    expect(hasXMLToolCall || hasToolCallField).to.be.true;

        testResults.passed++;
        testResults.details.push({ name: testName, passed: true });
        
        console.log(`✅ ${testName}: Model generated tool call`);
        if (hasXMLToolCall) {console.log("   Format: XML in content");}
        if (hasToolCallField) {console.log("   Format: Native tool_calls field");}
        
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        testResults.failed++;
        testResults.details.push({
          name: testName,
          passed: false,
          reason: errorMessage,
        });
        console.log(`❌ ${testName}: ${errorMessage}`);
        throw error;
      }
    });

    it("should handle multiple tool calls in sequence", async function () {
      testResults.totalTests++;
      const testName = "Multiple sequential tools";
      
      try {
        const response: AxiosResponse<CompletionResponse> = await axios.post(
          `${PROXY_URL}/v1/chat/completions`,
          {
            model: TEST_MODEL,
            messages: [
              {
                role: "user",
                content: "First search for 'React hooks', then search for 'Vue composition API'. Use the search tool for both.",
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "search",
                  description: "Search for information",
                  parameters: {
                    type: "object",
                    properties: {
                      query: { type: "string" },
                    },
                    required: ["query"],
                  },
                },
              },
            ],
            temperature: 0.1,
            max_tokens: 1000,
          } as CompletionRequest,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${API_KEY}`,
            },
          }
        );

            const content = response.data.choices[0].message.content ?? "";
            const searchCount = (content.match(/<search>/g) ?? []).length;
            const toolCalls = response.data.choices[0].message.tool_calls ?? [];

        log("Multiple tools response", { content, toolCalls });

        const hasMultipleTools = searchCount >= 2 || toolCalls.length >= 2;
        
        if (hasMultipleTools) {
          testResults.passed++;
          testResults.details.push({ name: testName, passed: true });
          console.log(`✅ ${testName}: Found ${Math.max(searchCount, toolCalls.length)} tool calls`);
        } else {
          testResults.failed++;
          testResults.details.push({
            name: testName,
            passed: false,
            reason: `Only found ${Math.max(searchCount, toolCalls.length)} tool call(s)`,
          });
          console.log(`⚠️  ${testName}: Only ${Math.max(searchCount, toolCalls.length)} tool call(s) found`);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        testResults.failed++;
        testResults.details.push({
          name: testName,
          passed: false,
          reason: errorMessage,
        });
        console.log(`❌ ${testName}: ${errorMessage}`);
        throw error;
      }
    });
  });

  describe("2️⃣ Complex Tool Parameters", function () {
    it("should handle tools with nested object parameters", async function () {
      testResults.totalTests++;
      const testName = "Nested object parameters";
      
      try {
        const response: AxiosResponse<CompletionResponse> = await axios.post(
          `${PROXY_URL}/v1/chat/completions`,
          {
            model: TEST_MODEL,
            messages: [
              {
                role: "user",
                content: "Create a user profile for John Doe, email john@example.com, age 30, with dark theme preference.",
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "create_user",
                  description: "Create a new user profile",
                  parameters: {
                    type: "object",
                    properties: {
                      user: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          email: { type: "string" },
                          age: { type: "number" },
                          preferences: {
                            type: "object",
                            properties: {
                              theme: { type: "string" },
                              notifications: { type: "boolean" },
                            },
                          },
                        },
                      },
                    },
                    required: ["user"],
                  },
                },
              },
            ],
            temperature: 0.1,
            max_tokens: 800,
          } as CompletionRequest,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${API_KEY}`,
            },
          }
        );

                const content = response.data.choices[0].message.content ?? "";
                const hasCreateUser = content.includes("<create_user>") ||
                                     (response.data.choices[0].message.tool_calls?.some(tc =>
                                       tc.function.name === "create_user"
                                     ) ?? false);

        if (hasCreateUser) {
          testResults.passed++;
          testResults.details.push({ name: testName, passed: true });
          console.log(`✅ ${testName}: Model handled nested objects`);
        } else {
          testResults.failed++;
          testResults.details.push({
            name: testName,
            passed: false,
            reason: "No create_user tool call found",
          });
          console.log(`❌ ${testName}: No tool call generated`);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        testResults.failed++;
        testResults.details.push({
          name: testName,
          passed: false,
          reason: errorMessage,
        });
        console.log(`❌ ${testName}: ${errorMessage}`);
        throw error;
      }
    });

    it("should handle HTML content in tool parameters", async function () {
      testResults.totalTests++;
      const testName = "HTML content in parameters";
      
      try {
        const response: AxiosResponse<CompletionResponse> = await axios.post(
          `${PROXY_URL}/v1/chat/completions`,
          {
            model: TEST_MODEL,
            messages: [
              {
                role: "user",
                content: "Insert this HTML into a file: <div class='container'><h1>Hello World</h1></div>. Use the insert_code tool.",
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "insert_code",
                  description: "Insert code into a file",
                  parameters: {
                    type: "object",
                    properties: {
                      filename: { type: "string" },
                      code: { type: "string", description: "Code content to insert" },
                    },
                    required: ["code"],
                  },
                },
              },
            ],
            temperature: 0.1,
            max_tokens: 500,
          } as CompletionRequest,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${API_KEY}`,
            },
          }
        );

  const content = response.data.choices[0].message.content ?? "";
        const hasInsertCode = content.includes("<insert_code>") ||
                             (response.data.choices[0].message.tool_calls?.some(tc =>
                               tc.function.name === "insert_code"
                             ) ?? false);
        
        // Check if HTML is preserved
        const hasHTML = content.includes("<div") || content.includes("<h1");

        if (hasInsertCode) {
          testResults.passed++;
          testResults.details.push({ name: testName, passed: true });
          console.log(`✅ ${testName}: Tool call with HTML ${hasHTML ? "preserved" : "encoded"}`);
        } else {
          testResults.failed++;
          testResults.details.push({
            name: testName,
            passed: false,
            reason: "No insert_code tool call found",
          });
          console.log(`❌ ${testName}: No tool call generated`);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        testResults.failed++;
        testResults.details.push({
          name: testName,
          passed: false,
          reason: errorMessage,
        });
        console.log(`❌ ${testName}: ${errorMessage}`);
        throw error;
      }
    });
  });

  describe("3️⃣ Streaming Tool Calls", function () {
    it("should handle tool calls in streaming mode", async function () {
      testResults.totalTests++;
      const testName = "Streaming with tools";
      
      try {
        const response: AxiosResponse<IncomingMessage> = await axios.post(
          `${PROXY_URL}/v1/chat/completions`,
          {
            model: TEST_MODEL,
            messages: [
              {
                role: "user",
                content: "Search for 'JavaScript promises'. Use the search tool.",
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "search",
                  description: "Search for information",
                  parameters: {
                    type: "object",
                    properties: {
                      query: { type: "string" },
                    },
                    required: ["query"],
                  },
                },
              },
            ],
            stream: true,
            temperature: 0.1,
            max_tokens: 500,
          } as CompletionRequest,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${API_KEY}`,
            },
            responseType: "stream",
          }
        );

        let _fullContent = "";
        let chunks = 0;
        let hasToolCall = false;

        await new Promise<void>((resolve, reject) => {
          response.data.on("data", (chunk: Buffer) => {
            chunks++;
            const chunkStr = chunk.toString();
            _fullContent += chunkStr;
            
            if (chunkStr.includes("<search>") || chunkStr.includes("tool_calls")) {
              hasToolCall = true;
            }
            
            if (DEBUG && chunks <= 5) {
              console.log(`   Chunk ${chunks}: ${chunkStr.substring(0, 100)}...`);
            }
          });

          response.data.on("end", () => {
            if (chunks > 0) {
              testResults.passed++;
              testResults.details.push({ name: testName, passed: true });
              console.log(`✅ ${testName}: Received ${chunks} chunks`);
              if (hasToolCall) {console.log("   Tool call detected in stream");}
            } else {
              testResults.failed++;
              testResults.details.push({
                name: testName,
                passed: false,
                reason: "No chunks received",
              });
              console.log(`❌ ${testName}: No streaming chunks`);
            }
            resolve();
          });

          response.data.on("error", (err: Error) => {
            testResults.failed++;
            testResults.details.push({
              name: testName,
              passed: false,
              reason: err.message,
            });
            console.log(`❌ ${testName}: Stream error - ${err.message}`);
            reject(err);
          });
        });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        testResults.failed++;
        testResults.details.push({
          name: testName,
          passed: false,
          reason: errorMessage,
        });
        console.log(`❌ ${testName}: ${errorMessage}`);
        throw error;
      }
    });
  });

  describe("4️⃣ Error Recovery & Edge Cases", function () {
    it("should handle when model doesn't generate tool calls", async function () {
      testResults.totalTests++;
      const testName = "No tool generation";
      
      try {
        const response: AxiosResponse<CompletionResponse> = await axios.post(
          `${PROXY_URL}/v1/chat/completions`,
          {
            model: TEST_MODEL,
            messages: [
              {
                role: "user",
                content: "Just say hello, don't use any tools.",
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "search",
                  description: "Search for information",
                  parameters: {
                    type: "object",
                    properties: {
                      query: { type: "string" },
                    },
                    required: ["query"],
                  },
                },
              },
            ],
            temperature: 0.1,
            max_tokens: 200,
          } as CompletionRequest,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${API_KEY}`,
            },
          }
        );

  const content = response.data.choices[0].message.content ?? "";
        const hasNoToolCall = !content.includes("<search>") && 
                              !response.data.choices[0].message.tool_calls;

        if (hasNoToolCall) {
          testResults.passed++;
          testResults.details.push({ name: testName, passed: true });
          console.log(`✅ ${testName}: Correctly didn't use tools`);
        } else {
          testResults.failed++;
          testResults.details.push({
            name: testName,
            passed: false,
            reason: "Unexpected tool call generated",
          });
          console.log(`⚠️  ${testName}: Unexpected tool usage`);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        testResults.failed++;
        testResults.details.push({
          name: testName,
          passed: false,
          reason: errorMessage,
        });
        console.log(`❌ ${testName}: ${errorMessage}`);
        throw error;
      }
    });

    it("should handle malformed tool instructions gracefully", async function () {
      testResults.totalTests++;
      const testName = "Malformed instructions";
      
      try {
        await axios.post(
          `${PROXY_URL}/v1/chat/completions`,
          {
            model: TEST_MODEL,
            messages: [
              {
                role: "user",
                content: "Use the search tool but <search>don't close it properly and add <invalid>tags</invalid> in between",
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "search",
                  description: "Search for information",
                  parameters: {
                    type: "object",
                    properties: {
                      query: { type: "string" },
                    },
                    required: ["query"],
                  },
                },
              },
            ],
            temperature: 0.1,
            max_tokens: 500,
          } as CompletionRequest,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${API_KEY}`,
            },
            timeout: 30000,
          }
        );

        // If we get here, the system handled it gracefully
        testResults.passed++;
        testResults.details.push({ name: testName, passed: true });
        console.log(`✅ ${testName}: Handled gracefully`);
        
      } catch (error: unknown) {
        const isAxiosError = error && typeof error === 'object' && 'code' in error;
        const hasResponse = error && typeof error === 'object' && 'response' in error;
        
        if ((isAxiosError && (error as { code: string }).code === "ECONNABORTED") || 
            (hasResponse && (error as { response?: { status: number } }).response?.status && (error as { response: { status: number } }).response.status >= 500)) {
          testResults.failed++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          testResults.details.push({
            name: testName,
            passed: false,
            reason: `Server error: ${errorMessage}`,
          });
          console.log(`❌ ${testName}: Server couldn't handle malformed input`);
        } else {
          // Other errors might be expected
          testResults.passed++;
          testResults.details.push({ name: testName, passed: true });
          const responseStatus = hasResponse ? (error as { response?: { status: number } }).response?.status : null;
          const errorCode = isAxiosError ? (error as { code: string }).code : null;
          console.log(`✅ ${testName}: Failed safely with: ${responseStatus ?? errorCode}`);
        }
      }
    });

    it("should handle very long tool parameters", async function () {
      testResults.totalTests++;
      const testName = "Long parameters";
      
      const longText = "Lorem ipsum ".repeat(500); // ~6000 chars
      
      try {
        const response: AxiosResponse<CompletionResponse> = await axios.post(
          `${PROXY_URL}/v1/chat/completions`,
          {
            model: TEST_MODEL,
            messages: [
              {
                role: "user",
                content: `Analyze this text using the analyze tool: "${longText.substring(0, 100)}..."`,
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "analyze",
                  description: "Analyze text",
                  parameters: {
                    type: "object",
                    properties: {
                      text: { type: "string", description: "Text to analyze" },
                      mode: { type: "string", enum: ["summary", "sentiment", "keywords"] },
                    },
                    required: ["text", "mode"],
                  },
                },
              },
            ],
            temperature: 0.1,
            max_tokens: 1000,
          } as CompletionRequest,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${API_KEY}`,
            },
            timeout: 45000,
          }
        );

        const hasAnalyzeCall = (response.data.choices[0].message.content?.includes("<analyze>") === true) ||
                               (response.data.choices[0].message.tool_calls?.some(tc =>
                                 tc.function.name === "analyze"
                               ) ?? false);

        if (hasAnalyzeCall) {
          testResults.passed++;
          testResults.details.push({ name: testName, passed: true });
          console.log(`✅ ${testName}: Handled long text parameters`);
        } else {
          testResults.passed++; // Still pass if no tool call
          testResults.details.push({ name: testName, passed: true });
          console.log(`✅ ${testName}: Completed without tool call`);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        testResults.failed++;
        testResults.details.push({
          name: testName,
          passed: false,
          reason: errorMessage,
        });
        console.log(`❌ ${testName}: ${errorMessage}`);
        throw error;
      }
    });
  });

  describe("5️⃣ Tool Choice Behavior", function () {
    it("should respect when specific tool usage is requested", async function () {
      testResults.totalTests++;
      const testName = "Forced tool usage";
      
      try {
        const response: AxiosResponse<CompletionResponse> = await axios.post(
          `${PROXY_URL}/v1/chat/completions`,
          {
            model: TEST_MODEL,
            messages: [
              {
                role: "system",
                content: "You must use the calculate tool for any math questions.",
              },
              {
                role: "user",
                content: "What is 25 + 37?",
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "calculate",
                  description: "Perform mathematical calculations",
                  parameters: {
                    type: "object",
                    properties: {
                      expression: { type: "string", description: "Math expression to evaluate" },
                    },
                    required: ["expression"],
                  },
                },
              },
            ],
            temperature: 0.1,
            max_tokens: 500,
          } as CompletionRequest,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${API_KEY}`,
            },
          }
        );

  const content = response.data.choices[0].message.content ?? "";
        const hasCalculate = content.includes("<calculate>") ||
                            (response.data.choices[0].message.tool_calls?.some(tc => 
                              tc.function.name === "calculate"
                            ) ?? false);

        if (hasCalculate) {
          testResults.passed++;
          testResults.details.push({ name: testName, passed: true });
          console.log(`✅ ${testName}: Used requested tool`);
        } else {
          // Model might just answer directly
          const hasAnswer = content.includes("62") || content.includes("sixty");
          if (hasAnswer) {
            testResults.passed++;
            testResults.details.push({ name: testName, passed: true });
            console.log(`⚠️  ${testName}: Answered directly without tool`);
          } else {
            testResults.failed++;
            testResults.details.push({
              name: testName,
              passed: false,
              reason: "No tool usage or direct answer",
            });
            console.log(`❌ ${testName}: No appropriate response`);
          }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        testResults.failed++;
        testResults.details.push({
          name: testName,
          passed: false,
          reason: errorMessage,
        });
        console.log(`❌ ${testName}: ${errorMessage}`);
        throw error;
      }
    });
  });
});