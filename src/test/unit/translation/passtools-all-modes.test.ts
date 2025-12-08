/**
 * Comprehensive test for passTools=false across ALL mode combinations
 * Verifies that tools are NEVER passed to backend when passTools=false
 */

import { expect } from "chai";
import { describe, it } from "mocha";
import { translate } from "../../../translation/index.js";

import type { OllamaRequest } from "../../../types/ollama.js";
import type { OpenAIRequest } from "../../../types/openai.js";

describe("passTools=false: ALL mode combinations", () => {
  const testTool = {
    type: "function" as const,
    function: {
      name: "test_function",
      description: "Test function",
      parameters: {
        type: "object" as const,
        properties: {
          arg: { type: "string" as const },
        },
        required: ["arg"],
      },
    },
  };

  it("OpenAI → OpenAI: strips tools when passTools=false", async () => {
    const request: OpenAIRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Test" }],
      tools: [testTool],
    };

    const result = await translate({
      from: "openai",
      to: "openai",
      request,
      context: {
        knownToolNames: ["test_function"],
        passTools: false,
      },
    });

    expect(result.success).to.be.true;
    const output = result.data as OpenAIRequest;
    expect(output.tools).to.be.undefined;
    expect(output.tool_choice).to.be.undefined;
  });

  it("OpenAI → Ollama: strips tools when passTools=false", async () => {
    const request: OpenAIRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Test" }],
      tools: [testTool],
    };

    const result = await translate({
      from: "openai",
      to: "ollama",
      request,
      context: {
        knownToolNames: ["test_function"],
        passTools: false,
      },
    });

    expect(result.success).to.be.true;
    const output = result.data as OllamaRequest;
    expect(output.tools).to.be.undefined;
  });

  it("Ollama → OpenAI: strips tools when passTools=false", async () => {
    const request: OllamaRequest = {
      model: "llama3.2",
      messages: [{ role: "user", content: "Test" }],
      tools: [testTool],
    };

    const result = await translate({
      from: "ollama",
      to: "openai",
      request,
      context: {
        knownToolNames: ["test_function"],
        passTools: false,
      },
    });

    expect(result.success).to.be.true;
    const output = result.data as OpenAIRequest;
    expect(output.tools).to.be.undefined;
    expect(output.tool_choice).to.be.undefined;
  });

  it("Ollama → Ollama: strips tools when passTools=false", async () => {
    const request: OllamaRequest = {
      model: "llama3.2",
      messages: [{ role: "user", content: "Test" }],
      tools: [testTool],
    };

    const result = await translate({
      from: "ollama",
      to: "ollama",
      request,
      context: {
        knownToolNames: ["test_function"],
        passTools: false,
      },
    });

    expect(result.success).to.be.true;
    const output = result.data as OllamaRequest;
    expect(output.tools).to.be.undefined;
  });

  it("ALL modes inject XML instructions when passTools=false", async () => {
    const modes: Array<{ from: "openai" | "ollama"; to: "openai" | "ollama" }> = [
      { from: "openai", to: "openai" },
      { from: "openai", to: "ollama" },
      { from: "ollama", to: "openai" },
      { from: "ollama", to: "ollama" },
    ];

    for (const { from, to } of modes) {
      const request =
        from === "openai"
          ? { model: "gpt-4", messages: [{ role: "user" as const, content: "Test" }], tools: [testTool] }
          : { model: "llama3.2", messages: [{ role: "user" as const, content: "Test" }], tools: [testTool] };

      const result = await translate({
        from,
        to,
        request,
        context: {
          knownToolNames: ["test_function"],
          passTools: false,
        },
      });

      expect(result.success).to.be.true;

      const output = result.data as { messages: Array<{ role: string; content: string }> };
      const systemMessage = output.messages.find((msg) => msg.role === "system");

      expect(
        systemMessage,
        `${from}→${to}: Should have system message with XML instructions`
      ).to.not.be.undefined;

      if (systemMessage) {
        expect(
          systemMessage.content,
          `${from}→${to}: System message should contain XML instructions`
        ).to.include("# TOOL USE CONFIGURATION");
      }
    }
  });
});
