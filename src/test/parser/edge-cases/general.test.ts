import { expect } from "chai";
import { describe, it } from "mocha";

import { detectPotentialToolCall } from "../../../handlers/toolCallHandler.js";

import type { ToolCallDetectionResult } from "../../../types/index.js";

describe("Edge Case Tests", function () {
  const knownToolNames: string[] = [
    "search",
    "run_code",
    "think",
    "replace_string_in_file",
    "insert_edit_into_file",
    "get_errors",
  ];

  const emptyContent = "";

  let veryLargeToolCall = "<think>\n";
  for (let i = 0; i < 5000; i++) {
    veryLargeToolCall += `  Line ${i}: This is a very long tool call that tests buffer handling\n`;
  }
  veryLargeToolCall += "</think>";

  let deeplyNestedXml = "<think>\n";
  for (let i = 0; i < 50; i++) {
    deeplyNestedXml += "  ".repeat(i) + `<level${i}>\n`;
  }
  for (let i = 49; i >= 0; i--) {
    deeplyNestedXml += "  ".repeat(i) + `</level${i}>\n`;
  }
  deeplyNestedXml += "</think>";

  const unicodeXml = `<think>
    UTF-8 characters: 你好, こんにちは, Привет, مرحبا, 안녕하세요
    Special symbols: ©®™§¶†‡※
    Emojis: 😀🚀💻🔥🌈
  </think>`;

  const invalidSyntaxToolCall = `<think>
    This has <unclosed tag
    And also has < illegal characters
    Plus missing closing tag`;

  const multipleToolTags = `<think>First thought</think><run_code>print("Hello")</run_code><get_errors>file.js</get_errors>`;

  const emptyToolCall = `<think></think>`;

  const wrongCaseToolCall = `<THINK>
    This tool name is uppercase but our known tools are lowercase
  </THINK>`;

  const extraContentToolName = "<thinkExtra>Content</thinkExtra>";

  const emptyToolList: string[] = [];

  const xmlWithComments = `<think>
    <!-- This is a comment inside a tool call -->
    Here is the actual content
    <!-- Another comment -->
  </think>`;

  const malformedClosingTag = `<think>
    Content here
  </thinkk>`;

  const normalXmlInCodeBlock =
    "```xml\n<custom>This is regular XML and should NOT be detected as a tool</custom>\n```";

  const toolInXmlCodeBlock =
    "```xml\n<think>This is a tool in a code block and should be detected</think>\n```";

  const partialToolInXmlCodeBlock =
    "```xml\n<thin>This is similar to a tool but not exact match</thin>\n```";

  it("should handle empty content", function () {
    const result: ToolCallDetectionResult = detectPotentialToolCall(emptyContent, knownToolNames);
    expect(result).to.deep.include({
      isPotential: false,
      mightBeToolCall: false,
      isCompletedXml: false,
      rootTagName: null,
    });
  });

  it("should handle very large tool calls", function () {
    const result: ToolCallDetectionResult = detectPotentialToolCall(veryLargeToolCall, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
    expect(result.rootTagName).to.equal("think");
  });

  it("should handle deeply nested XML", function () {
    const result: ToolCallDetectionResult = detectPotentialToolCall(deeplyNestedXml, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
    expect(result.rootTagName).to.equal("think");
  });

  it("should handle Unicode characters in XML", function () {
    const result: ToolCallDetectionResult = detectPotentialToolCall(unicodeXml, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
    expect(result.rootTagName).to.equal("think");
  });

  it("should handle invalid syntax in tool calls", function () {
    const result: ToolCallDetectionResult = detectPotentialToolCall(
      invalidSyntaxToolCall,
      knownToolNames,
    );
    expect(result.isPotential).to.be.true;
    expect(result.isCompletedXml).to.be.false;
  });

  it("should detect the first tool in multiple tool tags", function () {
    const result: ToolCallDetectionResult = detectPotentialToolCall(multipleToolTags, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
    expect(result.rootTagName).to.equal("think");
  });

  it("should handle empty tool calls", function () {
    const result: ToolCallDetectionResult = detectPotentialToolCall(emptyToolCall, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
    expect(result.rootTagName).to.equal("think");
  });

  it("should handle case-sensitive tool names", function () {
    const result: ToolCallDetectionResult = detectPotentialToolCall(wrongCaseToolCall, knownToolNames);
    expect(result.isPotential).to.be.false;
    expect(result.mightBeToolCall).to.be.false;
    expect(result.rootTagName).to.equal("THINK");
  });

  it("should not detect tool names that are partially matched", function () {
    const result: ToolCallDetectionResult = detectPotentialToolCall(
      extraContentToolName,
      knownToolNames,
    );
    expect(result.isPotential).to.be.false;
    expect(result.mightBeToolCall).to.be.false;
  });

  it("should handle empty tool list", function () {
    const result: ToolCallDetectionResult = detectPotentialToolCall(emptyToolCall, emptyToolList);
    expect(result.isPotential).to.be.false;
    expect(result.mightBeToolCall).to.be.false;
    expect(result.rootTagName).to.equal("think");
  });

  it("should handle XML with comments", function () {
    const result: ToolCallDetectionResult = detectPotentialToolCall(xmlWithComments, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
    expect(result.rootTagName).to.equal("think");
  });

  it("should handle malformed closing tags", function () {
    const result: ToolCallDetectionResult = detectPotentialToolCall(malformedClosingTag, knownToolNames);
    expect(result.isPotential).to.be.true;
    expect(result.isCompletedXml).to.be.false;
  });

  it("should handle XML in code blocks", function () {
    const result1: ToolCallDetectionResult = detectPotentialToolCall(
      normalXmlInCodeBlock,
      knownToolNames,
    );
    expect(result1.isPotential).to.be.false;

    const result2: ToolCallDetectionResult = detectPotentialToolCall(toolInXmlCodeBlock, knownToolNames);
    expect(result2).to.not.be.null;
    expect(result2.isPotential).to.be.true;
    expect(result2.mightBeToolCall).to.be.true;
    expect(result2.rootTagName).to.equal("think");

    const result3: ToolCallDetectionResult = detectPotentialToolCall(
      partialToolInXmlCodeBlock,
      knownToolNames,
    );
    expect(result3.isPotential).to.be.false;
    expect(result3.mightBeToolCall).to.be.false;
  });
});