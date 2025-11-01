import assert from "assert";

import { describe, it } from "mocha";

import { extractToolCallXMLParser } from "../../../parsers/xml/index.js";

import type { ExtractedToolCall } from "../../../types/index.js";

describe("Tool Parser - Malformed XML Edge Cases", () => {
  it("should handle missing closing tool tag", () => {
    const text = "Some text <tool_name><param1>value1<param2>value2</param2>";

    const result: ExtractedToolCall | null = extractToolCallXMLParser(text, ["tool_name"]);

    assert.notStrictEqual(
      result,
      null,
      "Parser should attempt to fix missing closing tags",
    );
    assert.strictEqual(
      (result as ExtractedToolCall).name,
      "tool_name",
      "Tool name should be correctly extracted when XML is fixed",
    );
    assert.strictEqual(
      ((result as ExtractedToolCall).arguments as Record<string, unknown>)['param2'],
      "value2",
      "Properly closed parameter is extracted",
    );
    assert.ok(
      !(((result as ExtractedToolCall).arguments as Record<string, unknown>)['param1']),
      "Unclosed parameter is excluded from result",
    );
  });

  it("should handle missing closing parameter tag", () => {
    const text = "Some text <tool_name><param>value</tool_name>";
    const result: ExtractedToolCall | null = extractToolCallXMLParser(text, ["tool_name"]);

    assert.notStrictEqual(
      result,
      null,
      "Parser handles malformed parameter tags",
    );
    assert.strictEqual(
      (result as ExtractedToolCall).name,
      "tool_name",
      "Tool name extracted correctly",
    );
    assert.deepStrictEqual(
      (result as ExtractedToolCall).arguments,
      {},
      "Malformed parameter is excluded from result",
    );
  });

  it("should handle mismatched parameter tags", () => {
    const text = "Some text <tool_name><param1>value</param2></tool_name>";
    const result: ExtractedToolCall | null = extractToolCallXMLParser(text, ["tool_name"]);

    assert.notStrictEqual(
      result,
      null,
      "Parser handles mismatched parameter tags",
    );
    assert.strictEqual(
      (result as ExtractedToolCall).name,
      "tool_name",
      "Tool name extracted correctly",
    );
    assert.deepStrictEqual(
      (result as ExtractedToolCall).arguments,
      {},
      "Mismatched parameters are excluded from result",
    );
  });

  it("should handle invalid characters in tag names (if parser rejects)", () => {
    const text = "Some text <tool name><param>value</param></tool name>";
    const result: ExtractedToolCall | null = extractToolCallXMLParser(text, ["tool name"]);

    assert.strictEqual(
      result,
      null,
      "Invalid characters in tag names should return null",
    );
  });

  it("should handle attributes in tool tags (should be ignored)", () => {
    const text =
      'Some text <tool_name attr="xyz"><param>value</param></tool_name>';
    const result: ExtractedToolCall | null = extractToolCallXMLParser(text, ["tool_name"]);

    assert.ok(result, "Tool call with attributes should be parsed");
    assert.strictEqual(
      (result).name,
      "tool_name",
      "Tool name should be extracted correctly",
    );
    assert.strictEqual(
      ((result).arguments as Record<string, unknown>)['param'],
      "value",
      "Parameter not extracted correctly from tool with attribute",
    );
  });

  it("should handle unclosed parameter tag within a valid tool call structure", () => {
    const text =
      "Text before <my_tool><param1>value1<param2>value2</param2></my_tool> Text after";
    const result: ExtractedToolCall | null = extractToolCallXMLParser(text, ["my_tool"]);

    assert.notStrictEqual(
      result,
      null,
      "Parser handles unclosed parameter tags",
    );
    assert.strictEqual((result as ExtractedToolCall).name, "my_tool", "Tool name extracted correctly");
    assert.strictEqual(
      ((result as ExtractedToolCall).arguments as Record<string, unknown>)['param2'],
      "value2",
      "Properly closed parameter is extracted",
    );
    assert.ok(
      !(((result as ExtractedToolCall).arguments as Record<string, unknown>)['param1']),
      "Unclosed parameter is excluded from result",
    );
  });

  it("should handle nested tool calls as structured data", () => {
    const text =
      "Outer text <outer_tool><inner_tool><param>value</param></inner_tool></outer_tool>";

    const result: ExtractedToolCall | null = extractToolCallXMLParser(text, ["outer_tool", "inner_tool"]);

    assert.notStrictEqual(result, null, "Should parse nested tool calls");
    assert.strictEqual(
      (result as ExtractedToolCall).name,
      "outer_tool",
      "Should parse outer tool as the main tool",
    );
    assert.ok(
      ((result as ExtractedToolCall).arguments as Record<string, unknown>)['inner_tool'],
      "Should contain inner_tool as a parameter",
    );

    const innerToolContent = ((result as ExtractedToolCall).arguments as Record<string, unknown>)['inner_tool'];
    assert.ok(
      typeof innerToolContent === "string" &&
        innerToolContent.includes("<param>value</param>"),
      "Inner tool content is preserved as string with the nested parameter",
    );
  });
});