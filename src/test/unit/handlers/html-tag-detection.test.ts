import assert from "assert";

import { describe, it } from "mocha";

import { detectPotentialToolCall } from "../../../handlers/toolCallHandler.js";

import type { ToolCallDetectionResult } from "../../../types/index.js";

describe("HTML Tag Detection Tests", () => {
  const knownTools: string[] = ["insert_edit_into_file", "search", "run_in_terminal"];

  describe("Common HTML Tag Detection", () => {
    it("should immediately reject common HTML opening tags", () => {
      const htmlTags: string[] = [
        "div",
        "span",
        "p",
        "h1",
        "h2",
        "style",
        "script",
        "body",
        "html",
        "head",
      ];

      htmlTags.forEach((tag: string) => {
        const content: string = `<${tag}>Some content`;
        const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownTools);

        assert.strictEqual(
          result.mightBeToolCall,
          false,
          `HTML tag <${tag}> should not be considered a potential tool call`,
        );
        assert.strictEqual(
          result.rootTagName,
          tag,
          `Root tag name should be correctly identified as '${tag}'`,
        );
      });
    });

    it("should immediately reject common HTML closing tags", () => {
      const htmlTags: string[] = ["div", "span", "p", "h1", "style", "script"];

      htmlTags.forEach((tag: string) => {
        const content: string = `</${tag}>`;
        const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownTools);

        assert.strictEqual(
          result.mightBeToolCall,
          false,
          `Closing HTML tag </${tag}> should not be considered a potential tool call`,
        );
      });
    });

    it("should reject HTML tags with attributes", () => {
      const content: string = '<div class="container" id="main">Content</div>';
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownTools);

      assert.strictEqual(
        result.mightBeToolCall,
        false,
        "HTML tag with attributes should not be considered a potential tool call",
      );
      assert.strictEqual(
        result.rootTagName,
        "div",
        "Root tag name should be correctly identified",
      );
    });

    it("should reject self-closing HTML tags", () => {
      const tags: string[] = ["img", "br", "hr", "input", "meta"];

      tags.forEach((tag: string) => {
        const content: string = `<${tag} />`;
        const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownTools);

        assert.strictEqual(
          result.mightBeToolCall,
          false,
          `Self-closing HTML tag <${tag} /> should not be considered a potential tool call`,
        );
      });
    });
  });

  describe("HTML vs Tool Call Differentiation", () => {
    it("should correctly differentiate HTML from tool calls", () => {
      const htmlContent: string = "<div>This is HTML content</div>";
      const htmlResult: ToolCallDetectionResult = detectPotentialToolCall(htmlContent, knownTools);

      const toolContent: string =
        "<insert_edit_into_file><explanation>Test</explanation></insert_edit_into_file>";
      const toolResult: ToolCallDetectionResult = detectPotentialToolCall(toolContent, knownTools);

      assert.strictEqual(
        htmlResult.mightBeToolCall,
        false,
        "HTML content should not be considered a potential tool call",
      );
      assert.strictEqual(
        toolResult.mightBeToolCall,
        true,
        "Valid tool call should be considered a potential tool call",
      );
    });

    it("should not reject valid tool calls that happen to start with HTML tag names", () => {
      const customTools: string[] = [...knownTools, "div_creator", "style_formatter"];

      const content1: string = "<div_creator><param>value</param></div_creator>";
      const content2: string =
        "<style_formatter><param>value</param></style_formatter>";

      const result1: ToolCallDetectionResult = detectPotentialToolCall(content1, customTools);
      const result2: ToolCallDetectionResult = detectPotentialToolCall(content2, customTools);

      assert.strictEqual(
        result1.mightBeToolCall,
        true,
        "Tool call with name starting with 'div' should be considered a potential tool call",
      );
      assert.strictEqual(
        result2.mightBeToolCall,
        true,
        "Tool call with name starting with 'style' should be considered a potential tool call",
      );
    });
  });
});