import { expect } from "chai";
import { describe, it } from "mocha";

import { detectPotentialToolCall } from "../../../handlers/toolCallHandler.js";

import type { ToolCallDetectionResult } from "../../../types/index.js";

describe("TagDetection Tests", function () {
  const knownToolNames: string[] = [
    "search",
    "run_code",
    "think",
    "insert_edit_into_file",
  ];

  it("should not detect HTML content as a tool call", function () {
    const htmlContent = `<header>
  <h1>Page Title</h1>
</header>
<section>
  <p>Some content here.</p>
</section>`;

    const htmlResult: ToolCallDetectionResult = detectPotentialToolCall(htmlContent, knownToolNames);
    expect(htmlResult.isPotential).to.be.false;
  });

  it("should detect valid tool call content", function () {
    const toolCallContent = `<think>
  I need to consider several factors here:
  1. Performance implications
  2. Security concerns
</think>`;

    const toolResult: ToolCallDetectionResult = detectPotentialToolCall(toolCallContent, knownToolNames);
    expect(toolResult).to.not.be.null;
    expect(toolResult.rootTagName).to.equal("think");
    expect(toolResult.isPotential).to.be.true;
    expect(toolResult.mightBeToolCall).to.be.true;
  });

  it("should not detect HTML-like structure that resembles but is not a known tool", function () {
    const similarContent = `<header>
  <think>This should not be detected as a tool call</think>
</header>`;

    const result: ToolCallDetectionResult = detectPotentialToolCall(similarContent, knownToolNames);
    expect(result.isPotential).to.be.false;
  });

  it("should detect tool calls with HTML-like content inside them", function () {
    const mixedContent = `<insert_edit_into_file>
  <explanation>Update the HTML</explanation>
  <filePath>/path/to/file.html</filePath>
  <code>
    <div class="container">
      <h1>Updated Title</h1>
    </div>
  </code>
</insert_edit_into_file>`;

    const result: ToolCallDetectionResult = detectPotentialToolCall(mixedContent, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.rootTagName).to.equal("insert_edit_into_file");
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
  });
});