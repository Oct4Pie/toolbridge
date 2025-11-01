import { expect } from "chai";
import { describe, it } from "mocha";

import { translate } from "../../../translation/index.js";

import type { OllamaRequest, OpenAIRequest } from "../../../types/index.js";

describe("Ollama translation request handling", () => {
  it("injects tool instructions and ToolCalls template marker", async () => {
    const openAIRequest: OpenAIRequest = {
      model: "gpt-4o-mini",
      messages: [
        { role: "user", content: "Give me a summary." },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "search",
            description: "Search the web for information",
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
      stream: false,
    };

    const translation = await translate({
      from: "openai",
      to: "ollama",
      request: openAIRequest,
    });

    expect(translation.success).to.be.true;
    const payload = translation.data as OllamaRequest;

    expect(payload.template).to.be.a("string");
    expect(payload.template).to.include("ToolCalls");

    const systemMessage = Array.isArray(payload.messages)
      ? payload.messages.find((msg) => msg.role === "system")
      : undefined;

    expect(systemMessage, "system message with tool instructions").to.exist;
    expect(systemMessage?.content).to.include("<toolbridge:calls>");
    expect(systemMessage?.content).to.include("search");
  });

  it("does not add template markers when no tools are present", async () => {
    const openAIRequest: OpenAIRequest = {
      model: "gpt-4o-mini",
      messages: [
        { role: "user", content: "Hello there." },
      ],
      stream: false,
    };

    const translation = await translate({
      from: "openai",
      to: "ollama",
      request: openAIRequest,
    });

    expect(translation.success).to.be.true;
    const payload = translation.data as OllamaRequest;

    expect(payload.template ?? "").to.not.include("ToolCalls");

    const systemMessage = Array.isArray(payload.messages)
      ? payload.messages.find((msg) => msg.role === "system")
      : undefined;

    expect(systemMessage?.content ?? "").to.not.include("<toolbridge:calls>");
  });
});
