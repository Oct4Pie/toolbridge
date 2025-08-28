import { expect } from "chai";
import { describe, it } from "mocha";

import { convertOllamaResponseToOllama } from "../../../utils/format/ollama/responseConverter.js";

import type { OllamaResponse } from "../../../types/index.js";

describe("Ollama response conversion", function () {
  it("should add ToolCalls to template if not already present", function () {
    const ollamaResponse: OllamaResponse = {
      model: "llama2",
      created_at: new Date().toISOString(),
      template: "{{system}}\n{{user}}\n{{assistant}}",
      response: "Hello, I'm an AI assistant.",
      done: true,
    };

    const converted: OllamaResponse = convertOllamaResponseToOllama(ollamaResponse);

    expect(converted.template).to.include("ToolCalls");
    expect(converted.template).to.equal(
      "{{system}}\n{{user}}\n{{assistant}} ToolCalls",
    );
  });

  it("should not modify template if ToolCalls is already present", function () {
    const ollamaResponse: OllamaResponse = {
      model: "llama2",
      created_at: new Date().toISOString(),
      template: "{{system}}\n{{user}}\n{{assistant}} ToolCalls",
      response: "Hello, I'm an AI assistant.",
      done: true,
    };

    const converted: OllamaResponse = convertOllamaResponseToOllama(ollamaResponse);

    expect(converted.template).to.equal(
      "{{system}}\n{{user}}\n{{assistant}} ToolCalls",
    );
  });

  it("should handle responses without a template property", function () {
    const ollamaResponse: OllamaResponse = {
      model: "llama2",
      created_at: new Date().toISOString(),
      response: "Hello, I'm an AI assistant.",
      done: true,
    };

    const converted: OllamaResponse = convertOllamaResponseToOllama(ollamaResponse);

    expect(converted).to.deep.equal(ollamaResponse);
  });

  it("should add template with ToolCalls when response has tool calls but no template", function () {
    const ollamaResponse: OllamaResponse = {
      model: "llama2",
      created_at: new Date().toISOString(),
      tool_calls: [{ function: { name: "search", arguments: {} } }],
      response: "",
      done: true,
    };

    const converted: OllamaResponse = convertOllamaResponseToOllama(ollamaResponse);

    expect(converted.template).to.equal(
      "{{system}}\n{{user}}\n{{assistant}} ToolCalls",
    );
  });

  it("should add template with ToolCalls when response might have XML tool calls", function () {
    const ollamaResponse: OllamaResponse = {
      model: "llama2",
      created_at: new Date().toISOString(),
      response:
        "Let me search for information <search><query>AI assistants</query></search>",
      done: true,
    };

    const converted: OllamaResponse = convertOllamaResponseToOllama(ollamaResponse);

    expect(converted.template).to.equal(
      "{{system}}\n{{user}}\n{{assistant}} ToolCalls",
    );
  });
});