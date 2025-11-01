import assert from "assert";

import { describe, it } from "mocha";

import { extractToolCallXMLParser } from "../../../parsers/xml/index.js";

import type { ExtractedToolCall } from "../../../types/index.js";

interface ToolCallResult {
  toolCalls?: Array<{
    tool_name: string;
    parameters: Record<string, unknown>;
  }>;
  text?: string;
}

describe("Tool Parser - Special Characters and CDATA Edge Cases", () => {
  it("should handle parameter value with XML entities", () => {
    const text = `Text <tool_name><param><value> & "quotes'</param></tool_name> After`;
    const result: ExtractedToolCall | null = extractToolCallXMLParser(text, ["tool_name"]);

    if (result && result.name === "tool_name") {
      assert.strictEqual(
        (result.arguments as Record<string, unknown>)['param'],
        "<value> & \"quotes'",
        "Test Case 1 Failed: Parameter value mismatch",
      );
    } else if (result && ((result as ToolCallResult).toolCalls?.length ?? 0) > 0) {
      const resultWithToolCalls = result as ToolCallResult;
      const expectedToolCall = {
        tool_name: "tool_name",
        parameters: { param: "<value> & \"quotes'" },
      };

      const calls = resultWithToolCalls.toolCalls ?? [];
      assert.strictEqual(
        calls.length,
        1,
        "Test Case 1 Failed: Tool call count",
      );
      assert.deepStrictEqual(
        calls[0],
        expectedToolCall,
        "Test Case 1 Failed: Tool call content",
      );
      assert.strictEqual(
        resultWithToolCalls.text,
        "Text  After",
        "Test Case 1 Failed: Remaining text",
      );
    } else {
      assert.fail("Test Case 1 Failed: No valid result returned");
    }
  });

  it("should handle parameter value with angle brackets (unescaped - potentially problematic)", () => {
    const text =
      "Text <tool_name><param>some <tag> here</param></tool_name> After";
    const result: ExtractedToolCall | null = extractToolCallXMLParser(text, ["tool_name"]);

    if (result && result.name === "tool_name") {
      assert.strictEqual(
        (result.arguments as Record<string, unknown>)['param'],
        "some <tag> here",
        "Test Case 2 Failed: Parameter value mismatch (unescaped <>)",
      );
    } else if (result && (result as ToolCallResult).toolCalls && ((result as ToolCallResult).toolCalls?.length ?? 0) > 0) {
      const resultWithToolCalls = result as ToolCallResult;
      const expectedToolCall = {
        tool_name: "tool_name",
        parameters: { param: "some <tag> here" },
      };

      const calls = resultWithToolCalls.toolCalls ?? [];
      assert.strictEqual(
        calls.length,
        1,
        "Test Case 2 Failed: Tool call count (unescaped <>)",
      );
      assert.deepStrictEqual(
        calls[0],
        expectedToolCall,
        "Test Case 2 Failed: Tool call content (unescaped <>)",
      );
      assert.strictEqual(
        resultWithToolCalls.text,
        "Text  After",
        "Test Case 2 Failed: Remaining text (unescaped <>)",
      );
    } else {
      assert.fail(
        "Test Case 2 Failed: No valid result returned (unescaped <>)",
      );
    }
  });
  
  it("should handle parameter value with CDATA section", () => {
    const text =
      'Text <tool_name><param><![CDATA[<value> & "unescaped" content]]></param></tool_name> After';
    const result: ExtractedToolCall | null = extractToolCallXMLParser(text, ["tool_name"]);

    assert.ok(result, "Result should not be null");
    assert.strictEqual(result.name, "tool_name", "Tool name should be correct");

    assert.strictEqual(
      (result.arguments as Record<string, unknown>)['param'],
      '<![CDATA[<value> & "unescaped" content]]>',
      "CDATA content should be extracted as implemented by the parser",
    );
  });

  it("should handle parameter value with mixed CDATA and regular text", () => {
    const text =
      "Text <tool_name><param>Regular text <![CDATA[<cdata>]]> more text</param></tool_name> After";
    const result: ExtractedToolCall | null = extractToolCallXMLParser(text, ["tool_name"]);

    assert.ok(result, "Result should not be null");
    assert.strictEqual(result.name, "tool_name", "Tool name should be correct");

    assert.strictEqual(
      (result.arguments as Record<string, unknown>)['param'],
      "Regular text <![CDATA[<cdata>]]> more text",
      "Mixed CDATA content should be extracted as implemented by the parser",
    );
  });

  it("should handle parameter value with newline characters", () => {
    const text =
      "Text <tool_name><param>Line 1\nLine 2\r\nLine 3</param></tool_name> After";
    const result: ExtractedToolCall | null = extractToolCallXMLParser(text, ["tool_name"]);

    if (result && result.name === "tool_name") {
      assert.strictEqual(
        (result.arguments as Record<string, unknown>)['param'],
        "Line 1\nLine 2\r\nLine 3",
        "Test Case 5 Failed: Parameter value mismatch (Newlines)",
      );
    } else if (result && (result as ToolCallResult).toolCalls && ((result as ToolCallResult).toolCalls?.length ?? 0) > 0) {
      const resultWithToolCalls = result as ToolCallResult;
      const expectedToolCall = {
        tool_name: "tool_name",
        parameters: { param: "Line 1\nLine 2\r\nLine 3" },
      };

      const calls = resultWithToolCalls.toolCalls ?? [];
      assert.strictEqual(
        calls.length,
        1,
        "Test Case 5 Failed: Tool call count (Newlines)",
      );
      assert.deepStrictEqual(
        calls[0],
        expectedToolCall,
        "Test Case 5 Failed: Tool call content (Newlines)",
      );
      assert.strictEqual(
        resultWithToolCalls.text,
        "Text  After",
        "Test Case 5 Failed: Remaining text (Newlines)",
      );
    } else {
      assert.fail("Test Case 5 Failed: No valid result returned (Newlines)");
    }
  });
});