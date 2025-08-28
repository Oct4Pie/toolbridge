
import { createServer } from "http";

import { expect } from "chai";
import express from "express";
import { after, before, describe, it } from "mocha";

import chatCompletionsHandler from "../../handlers/chatHandler.js";
import { detectPotentialToolCall } from "../../handlers/toolCallHandler.js";
import { attemptPartialToolCallExtraction } from "../../utils/xmlUtils.js";

import type { 
  ExtractedToolCall, 
  ToolCallDetectionResult, 
  PartialExtractionResult 
} from "../../types/index.js";
import type { Application, Request, Response } from "express";
import type { Server } from "http";

interface MockRequest {
  messages: Array<{ role: string; content: string }>;
  model: string;
  stream?: boolean;
  tools?: Array<{
    type: string;
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
  }>;
}

interface MockResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message?: {
      role: string;
      content: string;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    delta?: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

class MockLLMServer {
  private readonly app: Application;
  private server: Server | null = null;
  public port: number = 0;

  constructor() {
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.post("/v1/chat/completions", (req: Request, res: Response) => {
      const requestBody = req.body as MockRequest;
      
      if (requestBody.stream === true) {
        this.handleStreamingRequest(req, res);
      } else {
        this.handleNonStreamingRequest(req, res);
      }
    });
  }

  private handleNonStreamingRequest(req: Request, res: Response): void {
    const requestBody = req.body as MockRequest;
    const lastMessage = requestBody.messages[requestBody.messages.length - 1];
    
    let responseContent = "I'm a mock LLM response.";
    let toolCalls: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }> | undefined;

    if (lastMessage.content.includes("search for")) {
      responseContent = "Let me search for that information.";
      toolCalls = [{
        id: "call_123",
        type: "function",
        function: {
          name: "search",
          arguments: JSON.stringify({ query: "test query" })
        }
      }];
    } else if (lastMessage.content.includes("tool call")) {
      responseContent = "<search><query>test search</query></search>";
    }

    const response: MockResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: Date.now(),
      model: requestBody.model,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: responseContent,
          ...(toolCalls && { tool_calls: toolCalls })
        },
        finish_reason: "stop"
      }],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 20,
        total_tokens: 70
      }
    };

    res.json(response);
  }

  private handleStreamingRequest(req: Request, res: Response): void {
    const requestBody = req.body as MockRequest;
    
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });

    const chunks = [
      { delta: { role: "assistant", content: "" } },
      { delta: { content: "I'm " } },
      { delta: { content: "a mock " } },
      { delta: { content: "streaming " } },
      { delta: { content: "response." } },
      { delta: {}, finish_reason: "stop" }
    ];

    let chunkIndex = 0;
    const sendChunk = (): void => {
      if (chunkIndex < chunks.length) {
        const chunk: MockResponse = {
          id: "chatcmpl-123",
          object: "chat.completion.chunk",
          created: Date.now(),
          model: requestBody.model,
          choices: [{
            index: 0,
            ...chunks[chunkIndex],
            finish_reason: chunks[chunkIndex].finish_reason ?? null
          }]
        };

        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        chunkIndex++;
        setTimeout(sendChunk, 50);
      } else {
        res.write("data: [DONE]\n\n");
        res.end();
      }
    };

    sendChunk();
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer(this.app);
      this.server.listen(0, () => {
        const addr = this.server?.address();
        if (addr !== null && addr !== undefined && typeof addr === "object") {
          this.port = addr.port;
        }
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server?.close(() => resolve());
      });
    }
  }
}

describe("Integration Tests", function () {
  this.timeout(10000);
  
  let mockServer: MockLLMServer;
  let proxyApp: Application;
  let proxyServer: Server;
  let proxyPort: number;

  before(async function () {
    mockServer = new MockLLMServer();
    await mockServer.start();

    process.env.UPSTREAM_HOST = "localhost";
    process.env.UPSTREAM_PORT = mockServer.port.toString();

    proxyApp = express();
    proxyApp.use(express.json());
    proxyApp.post("/v1/chat/completions", chatCompletionsHandler);

    proxyServer = createServer(proxyApp);
    await new Promise<void>((resolve) => {
      proxyServer.listen(0, () => {
        const addr = proxyServer.address();
        if (typeof addr === "object" && addr !== null) {
          proxyPort = addr.port;
        }
        resolve();
      });
    });
  });

  after(async function () {
    await mockServer.stop();
    await new Promise<void>((resolve) => {
      proxyServer.close(() => resolve());
    });
  });

  describe("Non-streaming completions", function () {
    it("should proxy non-streaming requests correctly", async function () {
      const response = await fetch(`http://localhost:${proxyPort}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello" }],
          model: "test-model",
          stream: false
        })
      });

      expect(response.ok).to.be.true;
      const data = await response.json() as MockResponse;
      expect(data.choices[0].message?.content).to.include("mock LLM response");
    });
  });

  describe("Streaming completions", function () {
    it("should handle streaming responses", async function () {
      const response = await fetch(`http://localhost:${proxyPort}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello" }],
          model: "test-model",
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
        while (true) {
          const { done, value } = await reader.read();
          if (done) {break;}
          
          const chunk = decoder.decode(value);
          chunks.push(chunk);
          
          if (chunk.includes("[DONE]")) {break;}
        }
      } finally {
        reader.releaseLock();
      }

      expect(chunks.length).to.be.greaterThan(0);
      const fullResponse = chunks.join("");
      expect(fullResponse).to.include("streaming");
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
      const response = await fetch(`http://localhost:${proxyPort}/v1/chat/completions`, {
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