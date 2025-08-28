import assert from "assert";

import { describe, it } from "mocha";

import { attemptPartialToolCallExtraction } from "../../utils/xmlUtils.js";

import type { PartialExtractionResult } from "../../types/index.js";

describe("HTML Buffer Overflow Regression Tests", () => {
  const knownTools: string[] = ["insert_edit_into_file", "search", "run_in_terminal"];

  it("should not buffer indefinitely when encountering HTML closing tags", () => {
    const closingTag = "</style>";
    const regularContent =
      " This is some regular content that follows an HTML tag.";

    const initialResult: PartialExtractionResult = attemptPartialToolCallExtraction(
      closingTag,
      knownTools,
    );
    assert.strictEqual(
      initialResult.partialState?.buffer,
      "",
      "Buffer should be empty after encountering a closing HTML tag",
    );

    const nextResult: PartialExtractionResult = attemptPartialToolCallExtraction(
      closingTag + regularContent,
      knownTools,
    );
    assert.strictEqual(
      nextResult.partialState?.buffer,
      "",
      "Buffer should remain empty when adding content after a closing HTML tag",
    );

    const longContent = closingTag + " " + "x".repeat(5000);
    const longResult: PartialExtractionResult = attemptPartialToolCallExtraction(
      longContent,
      knownTools,
    );
    assert.strictEqual(
      longResult.partialState?.buffer,
      "",
      "Buffer should remain empty even with long content after a closing HTML tag",
    );
  });

  it("should still detect tool calls after HTML content", () => {
    const htmlContent =
      "<div>Some HTML content</div><style>body { color: red; }</style>";
    const toolCall =
      "<insert_edit_into_file><explanation>Test</explanation><filePath>/test.js</filePath><code>console.log('test');</code></insert_edit_into_file>";

    const fullContent = htmlContent + toolCall;
    const fullResult: PartialExtractionResult = attemptPartialToolCallExtraction(
      fullContent,
      knownTools,
    );

    assert.strictEqual(
      fullResult.complete,
      true,
      "Should detect tool call after HTML content",
    );
    assert.strictEqual(
      fullResult.toolCall?.name,
      "insert_edit_into_file",
      "Tool name should be correctly extracted",
    );
  });

  it("should handle the specific regression case with growing buffer", () => {
    const startContent = "</style>";

    attemptPartialToolCallExtraction(startContent, knownTools);

    const contentWithMoreText = startContent + "x".repeat(5000);
    const result: PartialExtractionResult = attemptPartialToolCallExtraction(
      contentWithMoreText,
      knownTools,
    );

    assert.strictEqual(
      result.partialState?.buffer,
      "",
      `Buffer should be empty after ${contentWithMoreText.length} chars`,
    );

    const contentWithToolCall =
      contentWithMoreText +
      "<insert_edit_into_file><explanation>Fix</explanation><filePath>/test.js</filePath><code>test</code></insert_edit_into_file>";
    const finalResult: PartialExtractionResult = attemptPartialToolCallExtraction(
      contentWithToolCall,
      knownTools,
    );

    assert.strictEqual(
      finalResult.complete,
      true,
      "Should detect tool call after large non-tool content",
    );
    assert.strictEqual(
      finalResult.toolCall?.name,
      "insert_edit_into_file",
      "Tool name should be correctly extracted",
    );
  });
});