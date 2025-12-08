import { expect } from "chai";
import { describe, it } from "mocha";

import { detectPotentialToolCall } from "../../../handlers/toolCallHandler.js";

import type { ToolCallDetectionResult } from "../../../types/index.js";

const knownToolNames: string[] = [
  "search",
  "run_code",
  "think",
  "replace_string_in_file",
  "insert_edit_into_file",
  "get_errors",
];

interface TestData {
  plainText: string;
  htmlContent: string;
  markdownWithHtml: string;
  validToolCall: string;
  incompleteToolCall: string;
  selfClosingToolCall: string;
  toolInText: string;
  multipleToolCalls: string;
  toolInCodeBlock: string;
  toolWithAttributes: string;
  toolWithSpecialChars: string;
  similarNonToolTag: string;
  toolWithCDATA: string;
  vscodeCell: string;
  nestedNonToolTags: string;
  textWithAngles: string;
  xmlWithNamespace: string;
  invalidXmlToolCall: string;
  incompleteXmlStart: string;
  toolInLongText?: string;
}

describe("XML Tool Call Detection - General Tests", function () {
  function testToolCallDetection(
    testName: string,
    content: string,
    expectedIsPotential: boolean,
    expectedMightBeToolCall: boolean,
    expectedIsComplete: boolean = false,
  ): void {
    it(testName, function () {
      const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

      expect(result.isPotential).to.equal(
        expectedIsPotential,
        "isPotential should match expected value",
      );
      expect(result.mightBeToolCall).to.equal(
        expectedMightBeToolCall,
        "mightBeToolCall should match expected value",
      );
      expect(result.isCompletedXml).to.equal(
        expectedIsComplete,
        "isCompletedXml should match expected value",
      );
    });
  }

  const testData: TestData = {
    plainText: "This is plain text with no XML tags whatsoever.",

    htmlContent: `<!DOCTYPE html>
<html>
<head>
  <title>Test Page</title>
</head>
<body>
  <header>
    <h1>Welcome to the Test</h1>
  </header>
  <main>
    <p>This is a paragraph with some <strong>bold</strong> text.</p>
  </main>
  <footer>&copy; 2025</footer>
</body>
</html>`,

    markdownWithHtml: `# My Document

This is a paragraph with some **bold** text and <span style="color:red;">colored</span> text.

<div class="container">
  Content inside a div
</div>

Here's some more markdown.`,

    validToolCall: `<think>
  I need to think about this problem carefully:
  1. First, understand the requirements
  2. Then, evaluate possible solutions
  3. Finally, implement the best approach
</think>`,

    incompleteToolCall: `<think>
  This is an incomplete tool call without a closing tag`,

    selfClosingToolCall: `<get_errors />`,

    toolInText: `Here's what I'm thinking: <think>we should consider all the options</think> before deciding.`,

    multipleToolCalls: `<think>First thought</think>
And then
<run_code>console.log("hello")</run_code>`,

    toolInCodeBlock: "```xml\n<search>query here</search>\n```",

    toolWithAttributes: `<run_code language="javascript" timeout="5000">
  console.log("Hello world");
</run_code>`,

    toolWithSpecialChars: `<think>
  Should we use if (x < 5 && y > 10) for this?
  Maybe check if &amp; is working?
</think>`,

    similarNonToolTag: `<thinker>
  This looks like a tool but isn't in our known tools list
</thinker>`,

    toolWithCDATA: `<run_code>
  <![CDATA[
    function test() {
      if (x < 10 && y > 5) {
        return true;
      }
    }
  ]]>
</run_code>`,

    vscodeCell: `<regular_xml_tag>
  This is just regular XML that should not be treated specially.
</regular_xml_tag>`,

    nestedNonToolTags: `<div>
  <header>
    <h1>Title</h1>
  </header>
  <p>Content</p>
</div>`,

    textWithAngles: `Consider the inequality x < 5 and y > 10 for this problem. When x < 0, we need to handle differently.`,

    xmlWithNamespace: `<ns:search xmlns:ns="http://example.org">
  Query string
</ns:search>`,

    invalidXmlToolCall: `<search>
  This has no closing tag
  <nested>But has a nested tag</nested>`,

    incompleteXmlStart: `<search`,
  };

  const toolInLongText = `This is a very long paragraph that contains a lot of text. 
It goes on for several sentences discussing various topics and ideas.
${testData.validToolCall}
After the tool call, there's another large block of text that continues
discussing the topic and providing more information to the reader.`;
  testData.toolInLongText = toolInLongText;

  describe("Non-tool content", function () {
    testToolCallDetection("Plain text", testData.plainText, false, false);
    testToolCallDetection("HTML content", testData.htmlContent, false, false);
    testToolCallDetection(
      "Markdown with HTML",
      testData.markdownWithHtml,
      false,
      false,
    );
    testToolCallDetection(
      "Text with angle brackets",
      testData.textWithAngles,
      false,
      false,
    );
    testToolCallDetection(
      "Nested non-tool tags",
      testData.nestedNonToolTags,
      false,
      false,
    );
    testToolCallDetection(
      "Similar but non-tool tag",
      testData.similarNonToolTag,
      false,
      false,
    );
    testToolCallDetection(
      "Regular XML tag (not a tool)",
      testData.vscodeCell,
      false,
      false,
    );
    testToolCallDetection(
      "XML with namespace",
      testData.xmlWithNamespace,
      false,
      false,
    );
    testToolCallDetection(
      "Incomplete XML start (buffered for streaming)",
      testData.incompleteXmlStart,
      true,
      true,
    );
  });

  describe("Valid tool calls", function () {
    testToolCallDetection(
      "Complete tool call",
      testData.validToolCall,
      true,
      true,
      true,
    );
    testToolCallDetection(
      "Self-closing tool call",
      testData.selfClosingToolCall,
      true,
      true,
      true,
    );
    testToolCallDetection(
      "Tool call with attributes",
      testData.toolWithAttributes,
      true,
      true,
      true,
    );
    testToolCallDetection(
      "Tool call with XML special chars",
      testData.toolWithSpecialChars,
      true,
      true,
      true,
    );
    testToolCallDetection(
      "Tool with CDATA section",
      testData.toolWithCDATA,
      true,
      true,
      true,
    );
    testToolCallDetection(
      "Tool in text",
      testData.toolInText,
      true,
      true,
      true,
    );
    testToolCallDetection(
      "Multiple tool calls",
      testData.multipleToolCalls,
      true,
      true,
      true,
    );
    testToolCallDetection(
      "Tool in code block",
      testData.toolInCodeBlock,
      true,
      true,
      true,
    );
    testToolCallDetection(
      "Tool in long text",
      testData.toolInLongText ?? "",
      true,
      true,
      true,
    );
  });

  describe("Invalid or incomplete tool calls", function () {
    testToolCallDetection(
      "Incomplete tool call",
      testData.incompleteToolCall,
      true,
      true,
      false,
    );
    testToolCallDetection(
      "Invalid XML tool call",
      testData.invalidXmlToolCall,
      true,
      true,
      false,
    );
  });
});