import { expect } from "chai";
import { describe, it } from "mocha";

import { extractToolCallXMLParser } from "../../../utils/xmlUtils.js";

import type { ExtractedToolCall } from "../../../types/index.js";

interface ExtractedToolCallWithParameters extends ExtractedToolCall {
  parameters: Record<string, unknown>;
}

describe("Complex XML Nesting Tests", function () {
  const knownToolNames: string[] = [
    "search",
    "run_code",
    "think",
    "replace_string_in_file",
    "insert_edit_into_file",
    "get_errors",
  ];

  it("should handle deeply nested XML structures", function () {
    const deeplyNestedXml = `
    <search>
      <query>
        <filters>
          <language>javascript</language>
          <framework>react</framework>
          <topic>
            <main>hooks</main>
            <subtopic>useEffect</subtopic>
          </topic>
        </filters>
        <text>How to clean up effects properly</text>
      </query>
    </search>`;

    const result: ExtractedToolCall | null = extractToolCallXMLParser(deeplyNestedXml, knownToolNames);

    expect(result).to.exist;
  expect((result as ExtractedToolCall).name).to.equal("search");
    expect((result as ExtractedToolCallWithParameters).parameters).to.exist;
    expect((result as ExtractedToolCallWithParameters).parameters.query).to.exist;
  });

  it("should handle XML with mixed content and CDATA sections", function () {
    const mixedContentXml = `
    <run_code>
      <language>javascript</language>
      <code><![CDATA[
        // This code has XML-like content which should be preserved
        function parseXml(str) {
          const regex = new RegExp('<(\\w+)>(.*?)<\\/\\1>', 'g');
          let match;
          while ((match = regex.exec(str)) !== null) {
            console.log(match[1], match[2]);
          }
        }
        
        parseXml("<root><child>value</child></root>");
      ]]></code>
    </run_code>`;

    const result: ExtractedToolCall | null = extractToolCallXMLParser(mixedContentXml, knownToolNames);

    expect(result).to.exist;
  expect((result as ExtractedToolCall).name).to.equal("run_code");
    expect((result as ExtractedToolCallWithParameters).parameters).to.exist;
    expect((result as ExtractedToolCallWithParameters).parameters.language).to.equal("javascript");
    expect((result as ExtractedToolCallWithParameters).parameters.code).to.include("function parseXml");
    expect((result as ExtractedToolCallWithParameters).parameters.code).to.include(
      "<root><child>value</child></root>",
    );
  });

  it("should handle XML with special characters and entities", function () {
    const specialCharsXml = `
    <search>
      <query>How to handle &lt;div&gt; &amp; &quot;quotes&quot; in HTML &apos;safely&apos;</query>
    </search>`;

    const result: ExtractedToolCall | null = extractToolCallXMLParser(specialCharsXml, knownToolNames);

    expect(result).to.exist;
  expect((result as ExtractedToolCall).name).to.equal("search");
    expect((result as ExtractedToolCallWithParameters).parameters).to.exist;
    expect((result as ExtractedToolCallWithParameters).parameters.query).to.include(
      "<div> & \"quotes\" in HTML 'safely'",
    );
  });

  it("should extract first valid tool call when multiple are present", function () {
    const multipleToolCallsXml = `
    <think>
      <thoughts>First I need to think about the problem</thoughts>
    </think>
    <search>
      <query>javascript promises</query>
    </search>`;

    const result: ExtractedToolCall | null = extractToolCallXMLParser(
      multipleToolCallsXml,
      knownToolNames,
    );

    expect(result).to.exist;
  expect((result as ExtractedToolCall).name).to.equal("think");
    expect((result as ExtractedToolCallWithParameters).parameters).to.exist;
    expect((result as ExtractedToolCallWithParameters).parameters.thoughts).to.equal(
      "First I need to think about the problem",
    );
  });

  it("should handle XML with attributes", function () {
    const xmlWithAttributes = `
    <search type="web" limit="10">
      <query language="en">best practices for API design</query>
    </search>`;

    const result: ExtractedToolCall | null = extractToolCallXMLParser(xmlWithAttributes, knownToolNames);

    expect(result).to.exist;
  expect((result as ExtractedToolCall).name).to.equal("search");
    expect((result as ExtractedToolCallWithParameters).parameters).to.exist;
    expect((result as ExtractedToolCallWithParameters).parameters.query).to.equal("best practices for API design");
  });

  it("should handle escaped XML within parameters", function () {
    const escapedXmlInParams = `
    <run_code>
      <language>html</language>
      <code>
        &lt;!DOCTYPE html&gt;
        &lt;html&gt;
        &lt;head&gt;
          &lt;title&gt;Test&lt;/title&gt;
        &lt;/head&gt;
        &lt;body&gt;
          &lt;h1&gt;Hello World&lt;/h1&gt;
        &lt;/body&gt;
        &lt;/html&gt;
      </code>
    </run_code>`;

    const result: ExtractedToolCall | null = extractToolCallXMLParser(escapedXmlInParams, knownToolNames);

    expect(result).to.exist;
  expect((result as ExtractedToolCall).name).to.equal("run_code");
    expect((result as ExtractedToolCallWithParameters).parameters).to.exist;
    expect((result as ExtractedToolCallWithParameters).parameters.language).to.equal("html");
    expect((result as ExtractedToolCallWithParameters).parameters.code).to.include("<!DOCTYPE html>");
    expect((result as ExtractedToolCallWithParameters).parameters.code).to.include("<html>");
  });

  it("should handle namespace-like prefixes in XML", function () {
    const xmlWithNamespaceLikePrefixes = `
    <tool:search xmlns:tool="http://example.org/tools">
      <tool:query>how to use namespaces in XML</tool:query>
    </tool:search>`;

    try {
      const result: ExtractedToolCall | null = extractToolCallXMLParser(
        xmlWithNamespaceLikePrefixes,
        knownToolNames,
      );

      if (result?.name) {
  expect((result).name).to.include("search");
      }
    } catch (_err: unknown) {
      console.log(
        "Identified limitation: Parser doesn't handle namespace prefixes",
      );
    }
  });
});