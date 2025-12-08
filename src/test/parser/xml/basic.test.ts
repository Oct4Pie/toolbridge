import assert from "assert";

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

function checkToolDetection(
  content: string,
  expectedIsPotential: boolean,
  expectedMightBeToolCall: boolean,
  expectedIsComplete: boolean = false,
): ToolCallDetectionResult {
  const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

  assert.strictEqual(
    result.isPotential,
    expectedIsPotential,
    `isPotential should be ${expectedIsPotential}`,
  );
  assert.strictEqual(
    result.mightBeToolCall,
    expectedMightBeToolCall,
    `mightBeToolCall should be ${expectedMightBeToolCall}`,
  );
  assert.strictEqual(
    result.isCompletedXml,
    expectedIsComplete,
    `isCompletedXml should be ${expectedIsComplete}`,
  );

  return result;
}

describe("Tool Detection Basic Tests", () => {
  it("should not detect tool calls in plain text", () => {
    const plainText = "This is plain text with no XML tags whatsoever.";
    checkToolDetection(plainText, false, false);
  });

  it("should not detect tool calls in HTML content", () => {
    const htmlContent = `<!DOCTYPE html>
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
</html>`;
    checkToolDetection(htmlContent, false, false);
  });

  it("should not detect tool calls in markdown with HTML", () => {
    const markdownWithHtml = `# My Document

This is a paragraph with some **bold** text and <span style="color:red;">colored</span> text.

<div class="container">
  Content inside a div
</div>

Here's some more markdown.`;
    checkToolDetection(markdownWithHtml, false, false);
  });

  it("should detect a valid complete tool call", () => {
    const validToolCall = `<think>
  I need to think about this problem carefully:
  1. First, understand the requirements
  2. Then, evaluate possible solutions
  3. Finally, implement the best approach
</think>`;
    checkToolDetection(validToolCall, true, true, true);
  });

  it("should detect an incomplete tool call", () => {
    const incompleteToolCall = `<think>
  This is an incomplete tool call without a closing tag`;
    checkToolDetection(incompleteToolCall, true, true, false);
  });

  it("should detect a self-closing tool call", () => {
    const selfClosingToolCall = `<get_errors />`;
    checkToolDetection(selfClosingToolCall, true, true, true);
  });

  it("should detect a tool call within text", () => {
    const toolInText = `Here's what I'm thinking: <think>we should consider all the options</think> before deciding.`;
    checkToolDetection(toolInText, true, true, true);
  });

  it("should detect multiple tool calls in text", () => {
    const multipleToolCalls = `<think>First thought</think>
And then
<run_code>console.log("hello")</run_code>`;
    checkToolDetection(multipleToolCalls, true, true, true);
  });

  it("should detect tool calls in code blocks", () => {
    const toolInCodeBlock = "```xml\n<search>query here</search>\n```";
    checkToolDetection(toolInCodeBlock, true, true, true);
  });

  it("should detect tool calls with attributes", () => {
    const toolWithAttributes = `<run_code language="javascript" timeout="5000">
  console.log("Hello world");
</run_code>`;
    checkToolDetection(toolWithAttributes, true, true, true);
  });

  it("should detect tool calls with XML special chars", () => {
    const toolWithSpecialChars = `<think>
  Should we use if (x < 5 && y > 10) for this?
  Maybe check if &amp; is working?
</think>`;
    checkToolDetection(toolWithSpecialChars, true, true, true);
  });

  it("should not detect similar but non-tool tags", () => {
    const similarNonToolTag = `<thinker>
  This looks like a tool but isn't in our known tools list
</thinker>`;
    checkToolDetection(similarNonToolTag, false, false);
  });

  it("should detect tool with CDATA section", () => {
    const toolWithCDATA = `<run_code>
  <![CDATA[
    function test() {
      if (x < 10 && y > 5) {
        return true;
      }
    }
  ]]>
</run_code>`;
    checkToolDetection(toolWithCDATA, true, true, true);
  });

  it("should not detect regular XML tag (not a tool)", () => {
    const regularXmlTag = `<regular_xml_tag>
  This is just regular XML that should not be treated specially.
</regular_xml_tag>`;
    checkToolDetection(regularXmlTag, false, false);
  });

  it("should not detect nested non-tool tags", () => {
    const nestedNonToolTags = `<div>
  <header>
    <h1>Title</h1>
  </header>
  <p>Content</p>
</div>`;
    checkToolDetection(nestedNonToolTags, false, false);
  });

  it("should not detect text with angle brackets as tool calls", () => {
    const textWithAngles = `Consider the inequality x < 5 and y > 10 for this problem. When x < 0, we need to handle differently.`;
    checkToolDetection(textWithAngles, false, false);
  });

  it("should not detect XML with namespace", () => {
    const xmlWithNamespace = `<ns:search xmlns:ns="http://example.org">
  Query string
</ns:search>`;
    checkToolDetection(xmlWithNamespace, false, false);
  });

  it("should detect invalid XML tool call as incomplete", () => {
    const invalidXmlToolCall = `<search>
  This has no closing tag
  <nested>But has a nested tag</nested>`;
    checkToolDetection(invalidXmlToolCall, true, true, false);
  });

  it("should detect tool in long text", () => {
    const validToolCallStr = `<think>
  I need to think about this problem carefully:
  1. First, understand the requirements
  2. Then, evaluate possible solutions
  3. Finally, implement the best approach
</think>`;
    const toolInLongText = `This is a very long paragraph that contains a lot of text. 
It goes on for several sentences discussing various topics and ideas.
${validToolCallStr}
After the tool call, there's another large block of text that continues
discussing the topic and providing more information to the reader.`;
    checkToolDetection(toolInLongText, true, true, true);
  });

  it("should detect incomplete XML start for streaming (>= 3 chars matching known tool)", () => {
    const incompleteXmlStart = `<search`;
    // Incomplete tag matching known tool should be buffered for streaming
    checkToolDetection(incompleteXmlStart, true, true, false);
  });

  it("should detect tool call with weird formatting", () => {
    const toolWithWeirdFormatting = `   <think>
       Indented strangely
    With inconsistent
 spacing
</think>   `;
    checkToolDetection(toolWithWeirdFormatting, true, true, true);
  });

  it("should detect tool call with newline variations", () => {
    const toolWithNewlineVariations = `<think>\nLet's analyze\r\nthis problem\n\rwith different\r\nnewlines\r</think>`;
    checkToolDetection(toolWithNewlineVariations, true, true, true);
  });

  it("should detect tool with Unicode quotes", () => {
    const toolWithUnicodeQuotes = `<run_code language="javascript">
  console.log("Smart quotes");
  let message = 'Single smart quotes';
</run_code>`;
    checkToolDetection(toolWithUnicodeQuotes, true, true, true);
  });

  it("should detect tool calls in markdown code block with language", () => {
    const markdownCodeWithLanguage =
      "```javascript\n<think>This is inside a JS code block</think>\n```";
    checkToolDetection(markdownCodeWithLanguage, true, true, true);
  });

  it("should detect tool with XML-like code inside", () => {
    const nestedXmlLikeCode = `<run_code>
  function generateXml() {
    return "<div><p>This looks like XML but is code</p></div>";
  }
</run_code>`;
    checkToolDetection(nestedXmlLikeCode, true, true, true);
  });
});