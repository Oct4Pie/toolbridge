/**
 * Integration test for passTools=false through full translation pipeline
 * Tests Ollama → OpenAI conversion with passTools: false
 */

import { expect } from "chai";
import { describe, it } from "mocha";
import { translate } from "../../../translation/index.js";

import type { OllamaRequest } from "../../../types/ollama.js";
import type { OpenAIRequest } from "../../../types/openai.js";

describe("passTools integration test: Ollama → OpenAI", () => {
  it("should strip native tool fields when passTools=false (Ollama client → OpenAI backend)", async () => {
    // Simulate: Ollama client sends request with tools → ToolBridge → OpenAI backend
    const ollamaRequest: OllamaRequest = {
      model: "llama3.2",
      messages: [
        {
          role: "user",
          content: "What's the weather like?",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get current weather",
            parameters: {
              type: "object",
              properties: {
                location: { type: "string" },
              },
              required: ["location"],
            },
          },
        },
      ],
      stream: false,
    };

    // Translate with passTools: false (should strip tools from backend request)
    const result = await translate({
      from: "ollama",
      to: "openai",
      request: ollamaRequest,
      context: {
        knownToolNames: ["get_weather"],
        enableXMLToolParsing: true,
        passTools: false, // KEY: This should strip native tool fields
      },
    });

    expect(result.success).to.be.true;
    expect(result.data).to.not.be.undefined;

    const openaiRequest = result.data as OpenAIRequest;

    // Verify native tool fields are stripped
    expect(openaiRequest.tools).to.be.undefined;
    expect(openaiRequest.tool_choice).to.be.undefined;

    // Verify XML instructions were injected
    const systemMessage = openaiRequest.messages.find((msg) => msg.role === "system");
    expect(systemMessage).to.not.be.undefined;
    if (systemMessage && typeof systemMessage.content === "string") {
      expect(systemMessage.content).to.include("# TOOL USAGE INSTRUCTIONS");
      expect(systemMessage.content).to.include("get_weather");
    }
  });

  it("should strip native tool fields when passTools=false (OpenAI client → OpenAI backend - SAME PROVIDER)", async () => {
    // This tests the CRITICAL case where client and backend are the same provider
    // The translator was bypassing applyTransformations() in this case!
    const openaiRequest: OpenAIRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: "What's the weather like?",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get current weather",
            parameters: {
              type: "object",
              properties: {
                location: { type: "string" },
              },
              required: ["location"],
            },
          },
        },
      ],
      stream: false,
    };

    // Translate with passTools: false (OpenAI → OpenAI)
    const result = await translate({
      from: "openai",
      to: "openai",
      request: openaiRequest,
      context: {
        knownToolNames: ["get_weather"],
        enableXMLToolParsing: true,
        passTools: false, // KEY: Must strip tools even when same provider!
      },
    });

    expect(result.success).to.be.true;
    expect(result.data).to.not.be.undefined;

    const outputRequest = result.data as OpenAIRequest;

    // Verify native tool fields are stripped
    expect(outputRequest.tools).to.be.undefined;
    expect(outputRequest.tool_choice).to.be.undefined;

    // Verify XML instructions were injected
    const systemMessage = outputRequest.messages.find((msg) => msg.role === "system");
    expect(systemMessage).to.not.be.undefined;
    if (systemMessage && typeof systemMessage.content === "string") {
      expect(systemMessage.content).to.include("# TOOL USAGE INSTRUCTIONS");
      expect(systemMessage.content).to.include("get_weather");
    }
  });

  it("should keep native tool fields when passTools=true (Ollama client → OpenAI backend)", async () => {
    const ollamaRequest: OllamaRequest = {
      model: "llama3.2",
      messages: [
        {
          role: "user",
          content: "What's the weather like?",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get current weather",
            parameters: {
              type: "object",
              properties: {
                location: { type: "string" },
              },
              required: ["location"],
            },
          },
        },
      ],
      stream: false,
    };

    // Translate with passTools: true (should keep tools in backend request)
    const result = await translate({
      from: "ollama",
      to: "openai",
      request: ollamaRequest,
      context: {
        knownToolNames: ["get_weather"],
        enableXMLToolParsing: true,
        passTools: true, // KEY: This should keep native tool fields
      },
    });

    expect(result.success).to.be.true;
    expect(result.data).to.not.be.undefined;

    const openaiRequest = result.data as OpenAIRequest;

    // Verify native tool fields are preserved
    expect(openaiRequest.tools).to.not.be.undefined;
    expect(Array.isArray(openaiRequest.tools)).to.be.true;
    const tools = openaiRequest.tools;
    if (tools && tools.length > 0) {
      expect(tools).to.have.lengthOf(1);
      const firstTool = tools[0];
      if (firstTool) {
        expect(firstTool.function.name).to.equal("get_weather");
      }
    }
  });
});
