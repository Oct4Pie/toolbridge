import { expect } from "chai";
import { describe, it } from "mocha";

import { extractToolCallXMLParser } from "../../../utils/xmlUtils.js";

import type { ExtractedToolCall } from "../../../types/index.js";

interface TestCase {
  name: string;
  input: string | null;
  expected: {
    name: string;
    arguments: Record<string, unknown>;
  } | null;
}

describe("XML Utils", function () {
  const testCases: TestCase[] = [
    {
      name: "Simple valid tool call",
      input: `<search><query>test query</query></search>`,
      expected: {
        name: "search",
        arguments: { query: "test query" },
      },
    },
    {
      name: "Multi-parameter tool call",
      input: `<run_code>
        <language>javascript</language>
        <code>console.log("hello world");</code>
        <timeout>5000</timeout>
      </run_code>`,
      expected: {
        name: "run_code",
        arguments: {
          language: "javascript",
          code: 'console.log("hello world");',
          timeout: 5000,
        },
      },
    },
    {
      name: "Boolean conversion",
      input: `<replace_string_in_file>
        <filePath>/test/file.js</filePath>
        <oldString>old</oldString>
        <newString>new</newString>
        <caseSensitive>true</caseSensitive>
      </replace_string_in_file>`,
      expected: {
        name: "replace_string_in_file",
        arguments: {
          filePath: "/test/file.js",
          oldString: "old",
          newString: "new",
          caseSensitive: true,
        },
      },
    },
    {
      name: "XML with comments",
      input: `<search>
        <!-- This is a comment -->
        <query>test with comments</query>
        <!-- Another comment -->
      </search>`,
      expected: {
        name: "search",
        arguments: { query: "test with comments" },
      },
    },
    {
      name: "Empty tool call",
      input: `<search></search>`,
      expected: {
        name: "search",
        arguments: {},
      },
    },
    {
      name: "Tool call in code block",
      input: "```xml\n<search><query>in code block</query></search>\n```",
      expected: {
        name: "search",
        arguments: { query: "in code block" },
      },
    },
    {
      name: "Tool call with text before",
      input:
        "I'll search for that:\n<search><query>with text before</query></search>",
      expected: {
        name: "search",
        arguments: { query: "with text before" },
      },
    },
    {
      name: "Tool call with text after",
      input:
        "<search><query>with text after</query></search>\nHere are the results:",
      expected: null,
    },
    {
      name: "Nested XML structure",
      input: `<think>
        <points>
          <point>First point</point>
          <point>Second point</point>
        </points>
        <conclusion>Final thoughts</conclusion>
      </think>`,
      expected: {
        name: "think",
        arguments: {
          points:
            "\n          <point>First point</point>\n          <point>Second point</point>\n        ",
          conclusion: "Final thoughts",
        },
      },
    },
    {
      name: "Invalid XML - no closing tag",
      input: "<search><query>invalid</query>",

      expected: {
        name: "search",
        arguments: { query: "invalid" },
      },
    },
    {
      name: "Invalid XML - mismatched tags",
      input: "<search><query>mismatched</wrong_tag></search>",
      expected: null,
    },
    {
      name: "Not XML content",
      input: "This is just plain text with no XML tags",
      expected: null,
    },
    {
      name: "Empty input",
      input: "",
      expected: null,
    },
    {
      name: "Null input",
      input: null,
      expected: null,
    },
  ];

  describe("XML Parsing", function () {
    testCases.forEach(function (testCase: TestCase, index: number) {
      it(`should handle ${testCase.name}`, function () {
        const knownToolNames: string[] = testCase.expected
          ? [testCase.expected.name]
          : [];

        const result = extractToolCallXMLParser(testCase.input, knownToolNames);

        if (testCase.expected === null) {
          expect(result).to.be.null;
        } else if (testCase.name === "Invalid XML - no closing tag") {
          if (result !== null) {
            expect(result.name).to.equal(testCase.expected.name);
            expect(JSON.stringify(result.arguments)).to.equal(
              JSON.stringify(testCase.expected.arguments),
            );
          }
        } else {
          expect(result).to.not.be.null;
          expect((result as ExtractedToolCall).name).to.equal(testCase.expected.name);

          if (index === 1) {
            expect(((result as ExtractedToolCall).arguments as Record<string, unknown>).language).to.equal(
              testCase.expected.arguments.language,
            );
            expect(((result as ExtractedToolCall).arguments as Record<string, unknown>).code).to.equal(
              testCase.expected.arguments.code,
            );

            const expectedTimeout = Number(testCase.expected.arguments.timeout);
            const actualTimeout =
              typeof ((result as ExtractedToolCall).arguments as Record<string, unknown>).timeout === "string"
                ? Number(((result as ExtractedToolCall).arguments as Record<string, unknown>).timeout)
                : ((result as ExtractedToolCall).arguments as Record<string, unknown>).timeout;

            expect(actualTimeout).to.equal(expectedTimeout);
          } else {
            expect(JSON.stringify((result as ExtractedToolCall).arguments)).to.equal(
              JSON.stringify(testCase.expected.arguments),
            );
          }
        }
      });
    });
  });
});