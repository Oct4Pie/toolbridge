import { expect } from "chai";
import { describe, it } from "mocha";

import { detectPotentialToolCall } from "../../handlers/toolCallHandler.js";

import type { ToolCallDetectionResult } from "../../types/index.js";

describe("Streaming XML Detection Tests", function () {
  const knownToolNames: string[] = [
    "search",
    "run_code",
    "think",
    "replace_string_in_file",
    "insert_edit_into_file",
    "get_errors",
  ];

  interface StreamingResult {
    detected: boolean;
    isPotential: boolean;
    mightBeToolCall: boolean;
    rootTagName: string | null;
    finalBuffer: string;
  }

  function simulateStreaming(chunks: string[]): StreamingResult {
    let buffer = "";
    let detected = false;
    let isPotential = false;
    let mightBeToolCall = false;
    let rootTagName: string | null = null;

    for (const chunk of chunks) {
      buffer += chunk;
      const result: ToolCallDetectionResult = detectPotentialToolCall(buffer, knownToolNames);

      if (result.isPotential && result.mightBeToolCall) {
        detected = true;
        isPotential = result.isPotential;
        mightBeToolCall = result.mightBeToolCall;
        rootTagName = result.rootTagName;
      }
    }

    return {
      detected,
      isPotential,
      mightBeToolCall,
      rootTagName,
      finalBuffer: buffer,
    };
  }

  it("should detect tool call in streamed chunks", function () {
    const toolCallChunks: string[] = [
      "<thi",
      "nk>\n  I need to analyze ",
      "this problem\n</th",
      "ink>",
    ];

    const result: StreamingResult = simulateStreaming(toolCallChunks);
    expect(result.detected).to.be.true;
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
    expect(result.rootTagName).to.equal("think");
  });

  it("should not detect HTML as tool calls", function () {
    const htmlChunks: string[] = [
      "<!DOCTYPE html>\n<ht",
      "ml>\n<head>\n  <title>Test</title>\n</head>\n<bo",
      "dy>\n  <header>\n    <h1>Title</h1>\n  </header>\n</bo",
      "dy>\n</html>",
    ];

    const result: StreamingResult = simulateStreaming(htmlChunks);
    expect(result.detected).to.be.false;
  });

  it("should detect tool call in mixed content", function () {
    const mixedChunks: string[] = [
      "I need to analyze this:\n\n<th",
      "ink>\n  This code has several issues:\n  1. Performance problems\n  ",
      "2. Security vulnerabilities\n  3. Maintainability concerns\n</thi",
      "nk>\n\nAs you can see from my analysis...",
    ];

    const result: StreamingResult = simulateStreaming(mixedChunks);
    expect(result.detected).to.be.true;
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
    expect(result.rootTagName).to.equal("think");
  });

  it("should handle malformed XML in streams", function () {
    const malformedChunks: string[] = [
      "<thin",
      "k>\n  This is incomplete XML with < illegal characters\n  and missing ",
      "closing brackets </thin",
    ];

    const result: StreamingResult = simulateStreaming(malformedChunks);
    expect(result.detected).to.be.true;
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
  });

  it("should handle nested tags in streamed content", function () {
    const nestedChunks: string[] = [
      "<insert_edit_into_file>\n  <explan",
      "ation>Add HTML</explanation>\n  <filePath>/path.html</filePath>\n  <co",
      "de>\n    <div>\n      <h1>Title</h1>\n    </div>\n  </co",
      "de>\n</insert_edit_into_file>",
    ];

    const result: StreamingResult = simulateStreaming(nestedChunks);
    expect(result.detected).to.be.true;
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
    expect(result.rootTagName).to.equal("insert_edit_into_file");
  });

  it("should handle unicode characters in streamed content", function () {
    const unicodeChunks: string[] = [
      "<th",
      "ink>\n  Unicode: 你好, こんにちは, Привет\n  Emojis: 😀🚀💻\n</th",
      "ink>",
    ];

    const result: StreamingResult = simulateStreaming(unicodeChunks);
    expect(result.detected).to.be.true;
    expect(result.isPotential).to.be.true;
    expect(result.mightBeToolCall).to.be.true;
    expect(result.rootTagName).to.equal("think");
  });
});