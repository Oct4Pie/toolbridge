import { expect } from "chai";
import { describe, it } from "mocha";

import { detectPotentialToolCall } from "../../../handlers/toolCallHandler.js";
import { extractToolCallXMLParser } from "../../../utils/xmlUtils.js";

import type { ToolCallDetectionResult, ExtractedToolCall } from "../../../types/index.js";

describe("Extreme Edge Case Tests", function () {
  const knownToolNames: string[] = [
    "search",
    "run_code",
    "think",
    "replace_string_in_file",
    "insert_edit_into_file",
    "create_file",
    "get_errors",
  ];

  it("should handle extremely long tool call content", function () {
    let longToolContent = "<think>\n";
    for (let i = 0; i < 1000; i++) {
      longToolContent += `  Line ${i}: This is a very long tool call that tests buffer handling\n`;
    }
    longToolContent += "</think>";

    const result: ToolCallDetectionResult = detectPotentialToolCall(longToolContent, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.rootTagName).to.equal("think");
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;

    const parsedResult: ExtractedToolCall | null = extractToolCallXMLParser(
      longToolContent,
      knownToolNames,
    );
    expect(parsedResult).to.not.be.null;
  expect((parsedResult as ExtractedToolCall).name).to.equal("think");
  });

  it("should detect the outermost tool call in nested structure", function () {
    const nestedToolCall = `<think>
      Here's what I think about the code:
      
      <run_code>
        console.log("This is a nested tool call that should be part of the think content");
      </run_code>
      
      That's my analysis.
    </think>`;

    const result: ToolCallDetectionResult = detectPotentialToolCall(nestedToolCall, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.rootTagName).to.equal("think");
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;

    const parsedResult: ExtractedToolCall | null = extractToolCallXMLParser(
      nestedToolCall,
      knownToolNames,
    );

    expect(parsedResult).to.not.be.null;
  expect((parsedResult as ExtractedToolCall).name).to.equal("think");

  const args = (parsedResult as ExtractedToolCall).arguments as Record<string, unknown>;
    const hasRunCodeAsParam = !!args.run_code;
    const hasRunCodeInText = Object.values(args).some(
      (val) => typeof val === "string" && val.includes("run_code"),
    );

    expect(hasRunCodeAsParam || hasRunCodeInText).to.be.true;
  });

  it("should handle special characters in tool calls", function () {
    const specialCharsContent = `<think>
      Special characters: &amp; &lt; &gt; &quot; &apos; 
      HTML entities: &amp;amp; &amp;lt; &amp;gt; &amp;quot; &amp;apos;
      XML-safe sequences: ]]&gt; 
      Unicode: 你好, こんにちは, Привет, مرحبا, 안녕하세요
      Emojis: 😀🔥💻🌍🎉
    </think>`;

    const result: ToolCallDetectionResult = detectPotentialToolCall(specialCharsContent, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.rootTagName).to.equal("think");
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;

    const parsedResult: ExtractedToolCall | null = extractToolCallXMLParser(
      specialCharsContent,
      knownToolNames,
    );
    expect(parsedResult).to.not.be.null;
  expect((parsedResult as ExtractedToolCall).name).to.equal("think");
  });

  it("should handle extremely malformed XML", function () {
    const malformedXml = `<think>
      This tag is <broken
      And this one is also broken>
      Missing closing angle bracket <parameter
      Mismatched tags <open></different>
      XML-reserved chars: & < > " '
    </think>`;

    const result: ToolCallDetectionResult = detectPotentialToolCall(malformedXml, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.rootTagName).to.equal("think");
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;

    const parsedResult: ExtractedToolCall | null = extractToolCallXMLParser(malformedXml, knownToolNames);
    expect(parsedResult).to.not.be.null;
  expect((parsedResult as ExtractedToolCall).name).to.equal("think");
  expect((parsedResult as ExtractedToolCall).arguments).to.be.a("object");
  });

  it("should handle unusual whitespace in tool calls", function () {
    const whitespaceFormatting = `
    
<think   >
     
     This content has unusual spacing and formatting
     
      
</think   >
    
    `;

    const result: ToolCallDetectionResult = detectPotentialToolCall(
      whitespaceFormatting,
      knownToolNames,
    );
    expect(result).to.not.be.null;
    expect(result.rootTagName).to.equal("think");
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;

    const parsedResult: ExtractedToolCall | null = extractToolCallXMLParser(
      whitespaceFormatting,
      knownToolNames,
    );
    expect(parsedResult).to.not.be.null;
  expect((parsedResult as ExtractedToolCall).name).to.equal("think");
  });

  it("should detect the first tool call when multiple are present", function () {
    const multipleToolCalls = `<think>First thought</think>
    
    <run_code>console.log("Hello")</run_code>
    
    <get_errors>file.js</get_errors>`;

    const result: ToolCallDetectionResult = detectPotentialToolCall(multipleToolCalls, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.rootTagName).to.equal("think");
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;

    const firstToolPattern = /<think>First thought<\/think>/;
    expect(multipleToolCalls).to.match(firstToolPattern);
  });
});