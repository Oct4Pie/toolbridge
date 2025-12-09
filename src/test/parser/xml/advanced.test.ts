import assert from "assert";

import { after, describe, it } from "mocha";

import { extractToolCall } from "../../../parsers/xml/index.js";

import type { ExtractedToolCall } from "../../../types/index.js";

describe("Advanced XML Tests", function () {
  const _knownToolNames: string[] = [
    "insert_edit_into_file",
    "create_file",
    "search",
    "get_files",
    "ls",
  ];

  let passCount = 0;
  let totalTests = 0;

  function testParser(name: string, content: string, shouldParse: boolean, _expectedToolName: string | null = null): void {
    it(`should ${shouldParse ? "parse" : "reject"} ${name}`, function () {
      const parsed: ExtractedToolCall | null = extractToolCall(content, _knownToolNames);

      if (shouldParse) {
        assert.ok(parsed, `Expected ${name} to parse successfully`);
        passCount++;
      } else {
        assert.ok(!parsed, `Expected ${name} to be rejected`);
        passCount++;
      }

      totalTests++;
    });
  }

  testParser(
    "basic valid XML",
    "<insert_edit_into_file>test</insert_edit_into_file>",
    true,
  );

  after(function () {
    console.log(
      `SUMMARY: ${passCount}/${totalTests} tests passed (${Math.round((passCount / totalTests) * 100)}%)`,
    );
  });
});
