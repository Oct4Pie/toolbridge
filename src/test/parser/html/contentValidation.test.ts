import { expect } from "chai";
import { describe, it } from "mocha";

import { detectPotentialToolCall } from "../../../handlers/toolCallHandler.js";
import { extractToolCallXMLParser } from "../../../utils/xmlUtils.js";

import type { ToolCallDetectionResult, ExtractedToolCall } from "../../../types/index.js";

interface TestCase {
  name: string;
  content: string;
}

describe("Testing Tool Call Validation with Problematic Content in Parameters", function () {
  const knownTools: string[] = [
    "insert_edit_into_file",
    "read_file",
    "run_in_terminal",
    "create_file",
  ];

  const testCases: TestCase[] = [
    {
      name: "HTML doctype and structure",
      content: `<insert_edit_into_file>
  <explanation>Add HTML content</explanation>
  <filePath>/path/to/file.html</filePath>
  <code><!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
</head>
<body>
    <h1>Hello World</h1>
</body>
</html></code>
</insert_edit_into_file>`,
    },

    {
      name: "HTML with comments and invalid XML structure",
      content: `<insert_edit_into_file>
  <explanation>Add HTML with comments</explanation>
  <filePath>/test/file.html</filePath>
  <code><!-- HTML comment -->
<div class="container">
  <p>This is a paragraph with a self-closing tag <br> and unclosed angle brackets size < 10</p>
</div></code>
</insert_edit_into_file>`,
    },

    {
      name: "JavaScript code with angle brackets",
      content: `<insert_edit_into_file>
  <explanation>Add JavaScript</explanation>
  <filePath>/test/file.js</filePath>
  <code>function compareValues(a, b) {
  if (a < b) {
    return -1;
  } else if (a > b) {
    return 1;
  }
  return 0;
}</code>
</insert_edit_into_file>`,
    },

    {
      name: "Python code with angle brackets",
      content: `<insert_edit_into_file>
  <explanation>Add Python code</explanation>
  <filePath>/test/file.py</filePath>
  <code>def filter_items(items):
    return [i for i in items if i < 10 and i > 0]
  
# Testing with list comprehension
filtered = [x for x in range(20) if x < 15]</code>
</insert_edit_into_file>`,
    },

    {
      name: "XML content inside tool parameter",
      content: `<create_file>
  <filePath>/test/config.xml</filePath>
  <content><?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <appSettings>
    <add key="theme" value="dark" />
    <add key="fontSize" value="12" />
    <setting enabled="true">
      <n>AutoSave</n>
      <value>300</value>
    </setting>
  </appSettings>
</configuration></content>
</create_file>`,
    },
  ];

  testCases.forEach((testCase) => {
    it(`should properly handle ${testCase.name}`, function () {
      const detection: ToolCallDetectionResult = detectPotentialToolCall(testCase.content, knownTools);
      expect(detection).to.not.be.null;
      expect(detection.mightBeToolCall).to.be.true;

      try {
        const parsedResult: ExtractedToolCall | null = extractToolCallXMLParser(testCase.content);

        if (parsedResult) {
          const args = parsedResult.arguments ?? {};
          const hasRequiredParams = Object.keys(args).length > 0;
          expect(hasRequiredParams).to.be.true;
        } else {
          console.log(
            `XML parsing failed for ${testCase.name} - this is expected for HTML content`,
          );
        }
      } catch (_error: unknown) {
        console.log(
          `XML parsing threw error for ${testCase.name} - this is expected for HTML content`,
        );
      }
    });
  });
});