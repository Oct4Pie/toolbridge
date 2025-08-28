import assert from "assert";

import { describe, it } from "mocha";

import { attemptPartialToolCallExtraction } from "../../../utils/xmlUtils.js";

import type { PartialExtractionResult, PartialToolCallState, ExtractedToolCall } from "../../../types/index.js";

describe("Buffer Size Limit Tests", () => {
  const knownTools: string[] = ["insert_edit_into_file", "search", "run_in_terminal"];

  it("should limit buffer size for non-tool content", () => {
    const largeContent: string = "x".repeat(12 * 1024);

    const result: PartialExtractionResult = attemptPartialToolCallExtraction(largeContent, knownTools);

    assert.strictEqual(
      result.complete,
      false,
      "Large non-tool content should not complete as a tool call",
    );
    assert.strictEqual(
      (result.partialState as PartialToolCallState).buffer,
      "",
      "Buffer should be empty for large non-tool content",
    );
  });

  it("should keep checking the end of content even when size limit is exceeded", () => {
    const prefix: string = "x".repeat(12 * 1024);
    const toolCall: string =
      "<insert_edit_into_file><explanation>Test</explanation><filePath>/test.js</filePath><code>console.log('test');</code></insert_edit_into_file>";

    const content: string = prefix + toolCall;

    const result: PartialExtractionResult = attemptPartialToolCallExtraction(content, knownTools);

    assert.strictEqual(
      result.complete,
      true,
      "Should still detect tool call at end of large content",
    );
    assert.strictEqual(
      (result.toolCall as ExtractedToolCall).name,
      "insert_edit_into_file",
      "Tool name should be correctly extracted",
    );
  });

  it("should reset buffer when an already-large buffer gets even larger", () => {
    const initialContent: string = "x".repeat(9 * 1024) + "<partial";

    const initialResult: PartialExtractionResult = attemptPartialToolCallExtraction(
      initialContent,
      knownTools,
    );

    const largerContent: string = initialContent + "x".repeat(3 * 1024);

    const nextResult: PartialExtractionResult = attemptPartialToolCallExtraction(
      largerContent,
      knownTools,
      initialResult.partialState,
    );

    assert.strictEqual(
      (nextResult.partialState as PartialToolCallState).buffer,
      "",
      "Buffer should be reset when growing beyond the limit with no valid tool",
    );
  });

  it("should still properly buffer valid partial tool calls under the size limit", () => {
    const partialTool: string =
      "<insert_edit_into_file><explanation>Test</explanation><filePath>/test.js</filePath><code>";

    const firstResult: PartialExtractionResult = attemptPartialToolCallExtraction(
      partialTool,
      knownTools,
    );

    const fullTool: string =
      partialTool + "console.log('test');</code></insert_edit_into_file>";

    const secondResult: PartialExtractionResult = attemptPartialToolCallExtraction(
      fullTool,
      knownTools,
      firstResult.partialState,
    );

    assert.strictEqual(
      secondResult.complete,
      true,
      "Complete tool call should be detected",
    );
    assert.strictEqual(
      (secondResult.toolCall as ExtractedToolCall).name,
      "insert_edit_into_file",
      "Tool name should be correctly extracted",
    );
  });

  it("should correctly process valid tools even if they are large", () => {
    const largeTool: string = `<insert_edit_into_file>
      <explanation>Large code block</explanation>
      <filePath>/test.js</filePath>
      <code>${"x".repeat(8 * 1024)}</code>
    </insert_edit_into_file>`;

    const result: PartialExtractionResult = attemptPartialToolCallExtraction(largeTool, knownTools);

    assert.strictEqual(
      result.complete,
      true,
      "Large but valid tool call should be detected",
    );
    assert.strictEqual(
      (result.toolCall as ExtractedToolCall).name,
      "insert_edit_into_file",
      "Tool name should be correctly extracted",
    );
    assert.strictEqual(
      (((result.toolCall as ExtractedToolCall).arguments as Record<string, unknown>).code as string).length,
      8 * 1024,
      "Large code content should be preserved",
    );
  });
});