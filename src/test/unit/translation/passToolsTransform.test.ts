import { expect } from "chai";
import { describe, it } from "mocha";
import { applyTransformations } from "../../../translation/utils/transformationUtils.js";

import type {
  CompatibilityResult,
  ConversionContext,
  GenericLLMRequest,
} from "../../../translation/types/index.js";

const baseCompatibility: CompatibilityResult = {
  compatible: true,
  warnings: [],
  unsupportedFeatures: [],
  transformations: [],
};

const createContext = (overrides: Partial<ConversionContext> = {}): ConversionContext => ({
  sourceProvider: "openai",
  targetProvider: "openai",
  requestId: "test",
  preserveExtensions: true,
  strictMode: false,
  knownToolNames: ["test_tool"],
  enableXMLToolParsing: true,
  transformationLog: [],
  ...overrides,
});

describe("applyTransformations with passTools=false", () => {
  it("strips native tool fields and injects XML instructions", () => {
    const request: GenericLLMRequest = {
      provider: "openai",
      model: "test-model",
      messages: [
        {
          role: "user",
          content: "Please call a tool.",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "test_tool",
            description: "Test tool",
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
      toolChoice: "auto",
    };

    const context = createContext({ passTools: false });

    const logSteps: Array<{ step: string; description: string }> = [];
    const result = applyTransformations(
      request,
      baseCompatibility,
      context,
      (ctx, step, description) => {
        ctx.transformationLog?.push({ step, description, timestamp: Date.now() });
        logSteps.push({ step, description });
      }
    );

    expect("tools" in result).to.be.false;
    expect("toolChoice" in result).to.be.false;

    const systemMessage = result.messages.find((msg) => msg.role === "system");
    expect(systemMessage).to.not.be.undefined;
    expect(typeof systemMessage?.content).to.equal("string");
    expect(String(systemMessage?.content)).to.include("<tool_code>");
    expect(String(systemMessage?.content)).to.include("IMPORTANT: The tools listed above");

    const stripStep = logSteps.find((entry) => entry.step === "strip_native_tools");
    expect(stripStep).to.not.be.undefined;
  });

  it("adds directive forbidding tool usage when toolChoice is none", () => {
    const request: GenericLLMRequest = {
      provider: "openai",
      model: "test-model",
      messages: [
        {
          role: "user",
          content: "No tools please.",
        },
      ],
      tools: [],
      toolChoice: "none",
    };

    const context = createContext({ passTools: false });

    const result = applyTransformations(
      request,
      baseCompatibility,
      context,
      () => { }
    );

    const systemMessage = result.messages.find((msg) => msg.role === "system");
    expect(systemMessage).to.not.be.undefined;
    expect(String(systemMessage?.content)).to.include("Tool usage is disabled for this request");
  });
});
