import { expect } from "chai";
import { after, describe, it } from "mocha";

import { detectPotentialToolCall } from "../../../handlers/toolCallHandler.js";
import { extractToolCallXMLParser } from "../../../utils/xmlUtils.js";

import type { ToolCallDetectionResult, ExtractedToolCall } from "../../../types/index.js";

interface StreamingResult {
  buffer: string;
  detected: ToolCallDetectionResult | null;
  extracted: ExtractedToolCall | null;
  error: unknown | null;
}

describe("Partial XML Detection Tests", function () {
  const knownToolNames: string[] = [
    "insert_edit_into_file",
    "create_file",
    "search",
    "get_files",
    "ls",
  ];

  let passCount = 0;
  let totalTests = 0;

  after(function () {
    console.log(
      `Partial XML Detection Tests: ${passCount}/${totalTests} passing`,
    );
  });

  function simulateStreaming(chunks: string[]): StreamingResult {
    let buffer = "";
    let detected: ToolCallDetectionResult | null = null;
    let extracted: ExtractedToolCall | null = null;
    let error: unknown | null = null;

    for (const chunk of chunks) {
      buffer += chunk;

      if (!(detected?.isPotential ?? false)) {
        detected = detectPotentialToolCall(buffer, knownToolNames);
      }

      if (
        detected !== null && detected !== undefined &&
        detected.isPotential &&
        detected.mightBeToolCall &&
        !extracted
      ) {
        try {
          extracted = extractToolCallXMLParser(buffer, knownToolNames);
        } catch (e: unknown) {
          error = e;
        }
      }
    }

    return { buffer, detected, extracted, error };
  }

  it("should detect a partial tool call at the beginning", function () {
    totalTests++;

    const content = `<insert_edit_into_file>
  <explanation>Add a function</explanation>
  <filePath>/path/to/file.js</filePath>
  <code>function hello() {
    console.log("Hello");
  }</code>
</insert`;

    const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
    expect(result.rootTagName).to.equal("insert_edit_into_file");

    try {
      const extracted: ExtractedToolCall | null = extractToolCallXMLParser(content);
      expect(extracted).to.be.null;
    } catch (e: unknown) {
      expect(e).to.exist;
    }

    passCount++;
  });

  it("should detect a tool call that arrives in chunks", function () {
    totalTests++;

    const chunks: string[] = [
      "<insert_edit_",
      "into_file>\n  <explanation>Update code</explanation>\n",
      "  <filePath>/app.js</filePath>\n  <code>const x = 10;</code>\n",
      "</insert_edit_into_file>",
    ];

    const result: StreamingResult = simulateStreaming(chunks);

    expect(result.detected).to.not.be.null;
    const det = result.detected as ToolCallDetectionResult;
    expect(det.isPotential).to.be.true;
    expect(det.mightBeToolCall).to.be.true;
    expect(det.rootTagName).to.equal("insert_edit_into_file");
    expect(result.extracted).to.not.be.null;
    const ext = result.extracted as ExtractedToolCall;
    expect(ext.name).to.equal("insert_edit_into_file");
    expect(ext.arguments).to.have.property(
      "explanation",
      "Update code",
    );

    passCount++;
  });

  it("should handle partial closing tags", function () {
    totalTests++;

    const content = `<create_file>
  <filePath>/test.txt</filePath>
  <content>Hello world</content>
</create_fi`;

    const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
    expect(result.rootTagName).to.equal("create_file");

    passCount++;
  });

  it("should not extract from partial XML", function () {
    totalTests++;

    const content = `<search>
  <query>How to implement`;

    const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
    expect(result.rootTagName).to.equal("search");

    const extracted: ExtractedToolCall | null = extractToolCallXMLParser(content);
    expect(extracted).to.be.null;

    passCount++;
  });

  it("should handle nested tags in partial content", function () {
    totalTests++;

    const content = `<insert_edit_into_file>
  <explanation>Add HTML</explanation>
  <filePath>/index.html</filePath>
  <code>
    <div>
      <h1>Title</h1>
      <p>Content</p>
    </div>
  </cod`;

    const result: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);
    expect(result).to.not.be.null;
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
    expect(result.rootTagName).to.equal("insert_edit_into_file");

    passCount++;
  });
});