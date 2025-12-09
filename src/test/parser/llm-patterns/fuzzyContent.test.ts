import { expect } from "chai";
import { describe, it } from "mocha";

import { detectPotentialToolCall } from "../../../handlers/toolCallHandler.js";
import { extractToolCall } from "../../../parsers/xml/index.js";

import type { ToolCallDetectionResult, ExtractedToolCall } from "../../../types/index.js";

describe("Fuzzy LLM Content Tests", function () {
  const knownToolNames: string[] = ["search", "analyze", "run_code"];

  it("should extract tool calls from mixed markdown and code content", function () {
    const complexInput = `<analyze>This user prefers dark theme and has notifications enabled.</analyze>`;

    const result: ToolCallDetectionResult = detectPotentialToolCall(complexInput, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.rootTagName).to.equal("analyze");
    expect(result.isPotential).to.be.true;

    const extracted: ExtractedToolCall | null = extractToolCall(complexInput, knownToolNames);
    expect(extracted).to.not.be.null;
  expect(extracted).to.not.be.null;
  const ex = extracted as ExtractedToolCall;
  expect(ex.name).to.equal("analyze");
  expect(ex.arguments).to.be.a("object");
  });

  it("should handle minimalist tool calls", function () {
    const minimalistToolCall = `<analyze>Simple analysis.</analyze>`;

    const result: ExtractedToolCall | null = extractToolCall(minimalistToolCall, knownToolNames);
    expect(result).to.not.be.null;
  expect((result as ExtractedToolCall).name).to.equal("analyze");
  expect((result as ExtractedToolCall).arguments).to.be.a("object");
  });

  it("should document behavior with tool calls followed by text", function () {
    const toolCallWithTrailingText = `<analyze>Analysis.</analyze>\nFollowed by more text`;

    const detected: ToolCallDetectionResult = detectPotentialToolCall(
      toolCallWithTrailingText,
      knownToolNames,
    );
    expect(detected).to.not.be.null;
    expect(detected.rootTagName).to.equal("analyze");
    expect(detected.isPotential).to.be.true;

    const result: ExtractedToolCall | null = extractToolCall(
      toolCallWithTrailingText,
      knownToolNames,
    );
    expect(result).to.not.be.null;
  expect((result as ExtractedToolCall).name).to.equal("analyze");
  expect((result as ExtractedToolCall).arguments).to.be.a("object");
  });

  it("should extract tool calls with text before but not after", function () {
    const toolCallWithLeadingText = `Here's my analysis: <analyze>Simple analysis.</analyze>`;

    const result: ExtractedToolCall | null = extractToolCall(
      toolCallWithLeadingText,
      knownToolNames,
    );
    expect(result).to.not.be.null;
  expect((result as ExtractedToolCall).name).to.equal("analyze");
  expect((result as ExtractedToolCall).arguments).to.be.a("object");
  });
});
