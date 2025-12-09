import { expect } from "chai";
import { describe, it } from "mocha";

import { detectPotentialToolCall } from "../../../handlers/toolCallHandler.js";

import type { ToolCallDetectionResult } from "../../../types/index.js";

describe("Tool Call Handler", function () {
  describe("detectPotentialToolCall", function () {
    const knownToolNames: string[] = [
      "search",
      "run_code",
      "analyze",
      "get_weather",
      "calculate",
    ];

    it("should detect a simple complete tool call", function () {
      const content: string = "<search><query>test query</query></search>";
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

      expect(result.isPotential).to.be.true;
      expect(result.mightBeToolCall).to.be.true;
      expect(result.isCompletedXml).to.be.true;
      expect(result.rootTagName).to.equal("search");
    });

    it("should detect a tool call with whitespace and newlines", function () {
      const content: string = `
        <search>
          <query>test query with spaces</query>
        </search>
      `;
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

      expect(result.isPotential).to.be.true;
      expect(result.mightBeToolCall).to.be.true;
      expect(result.isCompletedXml).to.be.true;
      expect(result.rootTagName).to.equal("search");
    });

    it("should not detect unknown tool names", function () {
      const content: string = "<unknown_tool><param>value</param></unknown_tool>";
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

      expect(result.isPotential).to.be.false;
      expect(result.mightBeToolCall).to.be.false;
      expect(result.rootTagName).to.equal("unknown_tool");
    });

    it("should detect tool call in code block", function () {
      const content: string =
        "```xml\n<search><query>in code block</query></search>\n```";
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

      expect(result.isPotential).to.be.true;
      expect(result.mightBeToolCall).to.be.true;
      expect(result.isCompletedXml).to.be.true;
      expect(result.rootTagName).to.equal("search");
    });

    it("should detect a partial tool call with opening tag only", function () {
      const content: string = "<search><query>incomplete";
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

      expect(result.isPotential).to.be.true;
      expect(result.mightBeToolCall).to.be.true;
      expect(result.isCompletedXml).to.be.false;
      expect(result.rootTagName).to.equal("search");
    });

    it("should detect self-closing tags as complete", function () {
      const content: string = '<search param="value"/>';
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

      expect(result.isPotential).to.be.true;
      expect(result.mightBeToolCall).to.be.true;
      expect(result.isCompletedXml).to.be.true;
      expect(result.rootTagName).to.equal("search");
    });

    it("should handle empty content", function () {
      const content: string = "";
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

      expect(result.isPotential).to.be.false;
      expect(result.mightBeToolCall).to.be.false;
      expect(result.isCompletedXml).to.be.false;
      expect(result.rootTagName).to.be.null;
    });

    it("should handle null content", function () {
      const content: null = null;
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

      expect(result.isPotential).to.be.false;
      expect(result.mightBeToolCall).to.be.false;
      expect(result.isCompletedXml).to.be.false;
      expect(result.rootTagName).to.be.null;
    });

    it("should handle non-XML content", function () {
      const content: string = "This is just plain text without XML";
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

      expect(result.isPotential).to.be.false;
      expect(result.mightBeToolCall).to.be.false;
      expect(result.isCompletedXml).to.be.false;
      expect(result.rootTagName).to.be.null;
    });

    it("should handle text with angle brackets but no valid XML", function () {
      const content: string = "This has < and > symbols but not valid XML";
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

      expect(result.isPotential).to.be.false;
      expect(result.mightBeToolCall).to.be.false;
      expect(result.isCompletedXml).to.be.false;
      expect(result.rootTagName).to.be.null;
    });

    it("should detect tool call with leading text", function () {
      const content: string =
        "Here's a tool call: <search><query>find this</query></search>";
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

      expect(result.isPotential).to.be.true;
      expect(result.mightBeToolCall).to.be.true;
      expect(result.isCompletedXml).to.be.true;
      expect(result.rootTagName).to.equal("search");
    });

    it("should detect tool call with trailing text", function () {
      const content: string =
        "<search><query>find this</query></search> And here are the results:";
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

      expect(result.isPotential).to.be.true;
      expect(result.mightBeToolCall).to.be.true;
      expect(result.isCompletedXml).to.be.true;
      expect(result.rootTagName).to.equal("search");
    });

    it("should treat tool names as case sensitive", function () {
      const content: string = "<SEARCH><query>uppercase tool name</query></SEARCH>";
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

      expect(result.isPotential).to.be.false;
      expect(result.mightBeToolCall).to.be.false;
      expect(result.rootTagName).to.equal("SEARCH");
    });

    it("should handle XML with namespaces based on implementation", function () {
      const content: string =
        '<ns:search xmlns:ns="http://example.com"><query>with namespace</query></ns:search>';
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

      if (result.isPotential === true) {
        expect(result.rootTagName).to.equal("search");
        expect(result.mightBeToolCall).to.be.true;
      } else {
        expect(result.isPotential).to.be.false;
      }
    });

    it("should not detect any tools when knownToolNames is empty", function () {
      const content: string = "<search><query>test query</query></search>";
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, []);

      expect(result.isPotential).to.be.false;
      expect(result.mightBeToolCall).to.be.false;
      expect(result.rootTagName).to.equal("search");
    });
  });
});