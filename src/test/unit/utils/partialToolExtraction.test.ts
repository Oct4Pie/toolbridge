import { expect } from "chai";
import { describe, it } from "mocha";

import { attemptPartialToolCallExtraction } from "../../../parsers/xml/index.js";

import type { 
  PartialExtractionResult, 
  PartialToolCallState, 
  ExtractedToolCall 
} from "../../../types/index.js";

describe("Partial Tool Call Extraction", function () {
  const knownToolNames: string[] = [
    "search",
    "run_code",
    "think",
    "get_weather",
    "calculate",
  ];

  describe("Single chunk extraction", function () {
    it("should extract complete tool call from a single chunk", function () {
      const content: string = "<search><query>test query</query></search>";
      const result: PartialExtractionResult = attemptPartialToolCallExtraction(content, knownToolNames);

      expect(result).to.have.property("complete", true);
    expect(result.toolCall).to.not.be.null;
    const toolCall1 = result.toolCall as ExtractedToolCall;
    expect(toolCall1).to.have.property("name", "search");
    expect((toolCall1.arguments as Record<string, unknown>)).to.have.property("query", "test query");
    });

    it("should identify incomplete tool call from a single chunk", function () {
      const content: string = "<search><query>incomplete";
      const result: PartialExtractionResult = attemptPartialToolCallExtraction(content, knownToolNames);

      expect(result).to.have.property("complete", false);
  expect(result.partialState).to.not.be.null;
  expect((result.partialState as PartialToolCallState).rootTag).to.equal("search");
  expect((result.partialState as PartialToolCallState).isPotential).to.be.true;
  expect((result.partialState as PartialToolCallState).buffer).to.equal(content);
    });

    it("should not extract unknown tool names", function () {
      const content: string = "<unknown_tool><param>value</param></unknown_tool>";
      const result: PartialExtractionResult = attemptPartialToolCallExtraction(content, knownToolNames);

      expect(result).to.have.property("complete", false);
  expect(result.partialState).to.not.be.null;

  expect((result.partialState as PartialToolCallState).rootTag).to.be.null;
  expect((result.partialState as PartialToolCallState).isPotential).to.be.false;
  expect((result.partialState as PartialToolCallState).mightBeToolCall).to.be.false;
    });
  });

  describe("Multi-chunk extraction", function () {
    it("should accumulate chunks and extract complete tool call", function () {
      const chunk1: string = "<se";
      const chunk2: string = "arch><query>test";
      const chunk3: string = " query</query></search>";

      const result1: PartialExtractionResult = attemptPartialToolCallExtraction(chunk1, knownToolNames);
      expect(result1).to.have.property("complete", false);

      const result2: PartialExtractionResult = attemptPartialToolCallExtraction(
        chunk1 + chunk2,
        knownToolNames,
        result1.partialState,
      );
      expect(result2).to.have.property("complete", false);

      const result3: PartialExtractionResult = attemptPartialToolCallExtraction(
        chunk1 + chunk2 + chunk3,
        knownToolNames,
        result2.partialState,
      );
      expect(result3).to.have.property("complete", true);
      expect(result3.toolCall).to.not.be.null;
    expect(result3.toolCall).to.not.be.null;
    const toolCall3 = result3.toolCall as ExtractedToolCall;
    expect(toolCall3).to.have.property("name", "search");
    expect((toolCall3.arguments as Record<string, unknown>)).to.have.property("query", "test query");
    });

    it("should maintain state between partial extractions", function () {
      const chunk1: string = "<think>";
      const result1: PartialExtractionResult = attemptPartialToolCallExtraction(chunk1, knownToolNames);

  expect(result1).to.have.property("complete", false);
  expect((result1.partialState as PartialToolCallState).rootTag).to.equal("think");
  expect((result1.partialState as PartialToolCallState).isPotential).to.be.true;

      const chunk2: string = "<think><thoughts>Some thoughts</thoughts>";
      const result2: PartialExtractionResult = attemptPartialToolCallExtraction(
        chunk2,
        knownToolNames,
        result1.partialState,
      );

  expect(result2).to.have.property("complete", false);
  expect((result2.partialState as PartialToolCallState).rootTag).to.equal("think");
  expect((result2.partialState as PartialToolCallState).isPotential).to.be.true;

      const chunk3: string = "<think><thoughts>Some thoughts</thoughts></think>";
      const result3: PartialExtractionResult = attemptPartialToolCallExtraction(
        chunk3,
        knownToolNames,
        result2.partialState,
      );

      expect(result3).to.have.property("complete", true);
      expect(result3.toolCall).to.not.be.null;
    expect(result3.toolCall).to.not.be.null;
    const toolCallThink = result3.toolCall as ExtractedToolCall;
    expect(toolCallThink.name).to.equal("think");
    expect((toolCallThink.arguments as Record<string, unknown>)).to.have.property("thoughts", "Some thoughts");
    });

    it("should not extract unknown tool calls across chunks", function () {
      const chunk1: string = "<unknown_";
      const result1: PartialExtractionResult = attemptPartialToolCallExtraction(chunk1, knownToolNames);

  expect(result1).to.have.property("complete", false);
  expect((result1.partialState as PartialToolCallState).rootTag).to.be.null;

      const chunk2: string = "<unknown_tool><param>";
      const result2: PartialExtractionResult = attemptPartialToolCallExtraction(
        chunk2,
        knownToolNames,
        result1.partialState,
      );

  expect(result2).to.have.property("complete", false);

  expect((result2.partialState as PartialToolCallState).rootTag).to.be.null;
  expect((result2.partialState as PartialToolCallState).isPotential).to.be.false;
  expect((result2.partialState as PartialToolCallState).mightBeToolCall).to.be.false;
    });
  });

  describe("Complex tool call extraction", function () {
    it("should extract tool calls with multiple parameters", function () {
      const content: string = `<run_code>
        <language>javascript</language>
        <code>console.log("hello world");</code>
        <timeout>5000</timeout>
      </run_code>`;

      const result: PartialExtractionResult = attemptPartialToolCallExtraction(content, knownToolNames);

      expect(result).to.have.property("complete", true);
  expect(result.toolCall).to.not.be.null;
  const toolCallComplex = result.toolCall as ExtractedToolCall;
  expect(toolCallComplex.name).to.equal("run_code");
  expect((toolCallComplex.arguments as Record<string, unknown>)).to.have.property(
        "language",
        "javascript",
      );
      expect((toolCallComplex.arguments as Record<string, unknown>)).to.have.property(
        "code",
        'console.log("hello world");',
      );
      expect((toolCallComplex.arguments as Record<string, unknown>)).to.have.property("timeout");
    });

    it("should handle HTML content inside tool parameters", function () {
      const content: string = `<run_code>
        <language>html</language>
        <code>
          <!DOCTYPE html>
          <html>
            <head><title>Test</title></head>
            <body>
              <div>Test content with < and > characters</div>
              <script>if(x < 10 && y > 5) {}</script>
            </body>
          </html>
        </code>
      </run_code>`;

      const result: PartialExtractionResult = attemptPartialToolCallExtraction(content, knownToolNames);

      expect(result).to.have.property("complete", true);
  expect(result.toolCall).to.not.be.null;
  const toolCallHtml = result.toolCall as ExtractedToolCall;
  expect(toolCallHtml.name).to.equal("run_code");
  expect((toolCallHtml.arguments as Record<string, unknown>)).to.have.property("language", "html");
        expect((toolCallHtml.arguments as Record<string, unknown>)).to.have.property("code");
        expect((toolCallHtml.arguments as Record<string, unknown>)['code']).to.include("<!DOCTYPE html>");
        expect((toolCallHtml.arguments as Record<string, unknown>)['code']).to.include(
          "<div>Test content with < and > characters</div>",
        );
        expect((toolCallHtml.arguments as Record<string, unknown>)['code']).to.include(
          "if(x < 10 && y > 5) {}",
        );
    });
  });

  describe("Edge cases", function () {
    it("should handle empty content", function () {
      const content: string = "";
      const result: PartialExtractionResult = attemptPartialToolCallExtraction(content, knownToolNames);

      expect(result).to.have.property("complete", false);
      expect(result.partialState).to.not.be.null;
    });

    it("should handle non-XML content", function () {
      const content: string = "This is just some text, not XML";
      const result: PartialExtractionResult = attemptPartialToolCallExtraction(content, knownToolNames);

      expect(result).to.have.property("complete", false);
      expect(result.partialState).to.not.be.null;
    });

    it("should handle malformed XML", function () {
      const content: string = "<search><query>malformed</query><search>";
      const result: PartialExtractionResult = attemptPartialToolCallExtraction(content, knownToolNames);

      expect(result).to.have.property("complete", false);
  expect(result.partialState).to.not.be.null;
  expect((result.partialState as PartialToolCallState).rootTag).to.equal("search");
    });

    it("should handle empty known tools array", function () {
      const content: string = "<search><query>test query</query></search>";
      const result: PartialExtractionResult = attemptPartialToolCallExtraction(content, []);

      expect(result).to.have.property("complete", false);

  expect(result.partialState).to.not.be.null;
  expect((result.partialState as PartialToolCallState).rootTag).to.be.null;
  expect((result.partialState as PartialToolCallState).isPotential).to.be.false;
  expect((result.partialState as PartialToolCallState).mightBeToolCall).to.be.false;
    });
  });
});