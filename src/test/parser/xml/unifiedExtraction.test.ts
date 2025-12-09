/**
 * Tests for Unified Tool Extraction
 *
 * Verifies that tool calls are correctly extracted both:
 * 1. With the <toolbridge_calls> wrapper (model followed instructions)
 * 2. Without the wrapper (model didn't follow instructions)
 *
 * This ensures compatibility with all models regardless of their
 * instruction-following capabilities.
 */

import { expect } from "chai";

import {
  extractToolCallUnified,
  extractToolCallsUnified,
} from "../../../parsers/xml/utils/unifiedToolExtraction.js";

describe("Unified Tool Extraction (SSOT)", function () {
  const knownToolNames = ["create_file", "read_file", "search", "run_code"];

  describe("extractToolCallUnified - Single Tool Call", function () {
    it("should extract tool call WITH wrapper (model followed instructions)", function () {
      const content = `<toolbridge_calls>
  <create_file>
    <filePath>hi</filePath>
    <content>Hello, world!</content>
  </create_file>
</toolbridge_calls>`;

      const result = extractToolCallUnified(content, knownToolNames);

      expect(result).to.not.be.null;
      expect(result?.name).to.equal("create_file");
      expect(result?.arguments).to.deep.equal({
        filePath: "hi",
        content: "Hello, world!",
      });
    });

    it("should extract tool call WITHOUT wrapper (model didn't follow instructions)", function () {
      // This is the exact case from the user's bug report
      const content = `<create_file>
  <filePath>hi</filePath>
  <content>Hello, world!</content>
</create_file>`;

      const result = extractToolCallUnified(content, knownToolNames);

      expect(result).to.not.be.null;
      expect(result?.name).to.equal("create_file");
      expect(result?.arguments).to.deep.equal({
        filePath: "hi",
        content: "Hello, world!",
      });
    });

    it("should prefer wrapper-based extraction when wrapper is present", function () {
      // This test ensures that if both forms exist, wrapper is preferred
      const content = `<toolbridge_calls>
  <create_file>
    <filePath>correct</filePath>
    <content>From wrapper</content>
  </create_file>
</toolbridge_calls>`;

      const result = extractToolCallUnified(content, knownToolNames);

      expect(result).to.not.be.null;
      expect(result?.name).to.equal("create_file");
      const args = result?.arguments as Record<string, unknown>;
      expect(args["filePath"]).to.equal("correct");
    });

    it("should extract tool call with preface text (no wrapper)", function () {
      const content = `Here's the file I'll create for you:
<create_file>
  <filePath>test.txt</filePath>
  <content>Test content</content>
</create_file>`;

      const result = extractToolCallUnified(content, knownToolNames);

      expect(result).to.not.be.null;
      expect(result?.name).to.equal("create_file");
    });

    it("should extract tool call with trailing text (no wrapper)", function () {
      const content = `<search>
  <query>find something</query>
</search>
That's my search query!`;

      const result = extractToolCallUnified(content, knownToolNames);

      expect(result).to.not.be.null;
      expect(result?.name).to.equal("search");
      const args = result?.arguments as Record<string, unknown>;
      expect(args["query"]).to.equal("find something");
    });

    it("should return null for non-tool content", function () {
      const content = "This is just plain text without any tool calls.";

      const result = extractToolCallUnified(content, knownToolNames);

      expect(result).to.be.null;
    });

    it("should return null for empty content", function () {
      expect(extractToolCallUnified("", knownToolNames)).to.be.null;
      expect(extractToolCallUnified(null, knownToolNames)).to.be.null;
      expect(extractToolCallUnified(undefined, knownToolNames)).to.be.null;
    });

    it("should return null for unknown tool names", function () {
      const content = `<unknown_tool>
  <param>value</param>
</unknown_tool>`;

      const result = extractToolCallUnified(content, knownToolNames);

      expect(result).to.be.null;
    });
  });

  describe("extractToolCallsUnified - Multiple Tool Calls", function () {
    it("should extract multiple tool calls WITH wrapper", function () {
      const content = `<toolbridge_calls>
  <create_file>
    <filePath>file1.txt</filePath>
    <content>Content 1</content>
  </create_file>
  <read_file>
    <filePath>file2.txt</filePath>
  </read_file>
</toolbridge_calls>`;

      const results = extractToolCallsUnified(content, knownToolNames);

      expect(results).to.have.lengthOf(2);
      expect(results[0]?.name).to.equal("create_file");
      expect(results[1]?.name).to.equal("read_file");
    });

    it("should extract multiple tool calls WITHOUT wrapper", function () {
      const content = `<create_file>
  <filePath>file1.txt</filePath>
  <content>Content 1</content>
</create_file>
<read_file>
  <filePath>file2.txt</filePath>
</read_file>`;

      const results = extractToolCallsUnified(content, knownToolNames);

      expect(results).to.have.lengthOf(2);
      expect(results[0]?.name).to.equal("create_file");
      expect(results[1]?.name).to.equal("read_file");
    });

    it("should return empty array for non-tool content", function () {
      const content = "This is just plain text.";

      const results = extractToolCallsUnified(content, knownToolNames);

      expect(results).to.be.an("array").that.is.empty;
    });

    it("should return empty array for null/empty content", function () {
      expect(extractToolCallsUnified("", knownToolNames)).to.be.an("array").that.is.empty;
      expect(extractToolCallsUnified(null, knownToolNames)).to.be.an("array").that.is.empty;
      expect(extractToolCallsUnified(undefined, knownToolNames)).to.be.an("array").that.is.empty;
    });
  });

  describe("Edge Cases", function () {
    it("should handle JSON parameters in tool calls", function () {
      const content = `<run_code>{"language":"python","code":"print('hello')"}</run_code>`;

      const result = extractToolCallUnified(content, knownToolNames);

      expect(result).to.not.be.null;
      expect(result?.name).to.equal("run_code");
    });

    it("should handle nested XML in parameters", function () {
      const content = `<create_file>
  <filePath>index.html</filePath>
  <content><html><body><h1>Hello</h1></body></html></content>
</create_file>`;

      const result = extractToolCallUnified(content, knownToolNames);

      expect(result).to.not.be.null;
      expect(result?.name).to.equal("create_file");
    });

    it("should handle thinking tags around tool calls", function () {
      const content = `<thinking>I need to create a file</thinking>
<toolbridge_calls>
  <create_file>
    <filePath>test.txt</filePath>
    <content>Test</content>
  </create_file>
</toolbridge_calls>`;

      const result = extractToolCallUnified(content, knownToolNames);

      expect(result).to.not.be.null;
      expect(result?.name).to.equal("create_file");
    });
  });
});
