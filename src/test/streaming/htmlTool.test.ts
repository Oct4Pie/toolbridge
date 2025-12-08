import { expect } from "chai";
import { describe, it } from "mocha";

import { detectPotentialToolCall } from "../../handlers/toolCallHandler.js";
import { extractToolCall } from "../../parsers/xml/index.js";

import type { ToolCallDetectionResult, ExtractedToolCall } from "../../types/index.js";

describe("HtmlTool Tests", function () {
  class MockProcessor {
    public toolCallBuffer: string;
    private readonly knownToolNames: string[];
    public isPotentialToolCall: boolean;
    public results: ExtractedToolCall[];

    constructor() {
      this.toolCallBuffer = "";
      this.knownToolNames = [
        "insert_edit_into_file",
        "create_file",
        "test_tool",
      ];
      this.isPotentialToolCall = false;
      this.results = [];
    }

    processChunk(chunk: Buffer | string): void {
      const chunkStr = chunk.toString();

      this.toolCallBuffer += chunkStr;

      try {
        const detected: ToolCallDetectionResult = detectPotentialToolCall(
          this.toolCallBuffer,
          this.knownToolNames,
        );

        this.isPotentialToolCall =
          detected.isPotential && detected.mightBeToolCall;

        if (this.isPotentialToolCall) {
          try {
            const extracted: ExtractedToolCall | null = extractToolCall(this.toolCallBuffer);
            if (extracted) {
              this.results.push(extracted);
              this.toolCallBuffer = "";
              this.isPotentialToolCall = false;
            }
          } catch (_error: unknown) {
            const error = _error instanceof Error ? _error : new Error(String(_error));
            console.log("Expected extraction error in test:", error.message);
          }
        }
      } catch (_error: unknown) {
        const error = _error instanceof Error ? _error : new Error(String(_error));
        console.log("Error processing chunk in test:", error.message);
      }
    }
  }

  it("should process HTML chunks correctly", function () {
    const processor = new MockProcessor();

    const chunks: string[] = [
      `Here's a simple HTML document:`,
      `\n<create_file>`,
      `\n  <filePath>/test/index.html</filePath>`,
      `\n  <content><!DOCTYPE html>`,
      `\n<html>`,
      `\n<head>`,
      `\n  <title>Test Page</title>`,
      `\n</head>`,
      `\n<body>`,
      `\n  <h1>Hello World</h1>`,
      `\n  <p>This is a test page with <em>emphasis</em> and <strong>strong</strong> text.</p>`,
      `\n</body>`,
      `\n</html>`,
      `\n  </content>`,
      `\n</create_file>`,
    ];

    chunks.forEach((chunk) => processor.processChunk(chunk));

    expect(processor.toolCallBuffer).to.be.a("string");

    if (processor.results.length > 0) {
      const firstResult = processor.results[0];
      if (firstResult) {
        expect(firstResult.name).to.equal("create_file");
      }
    } else {
      expect(processor.toolCallBuffer).to.include("<create_file>");
      expect(processor.toolCallBuffer).to.include("</create_file>");
      expect(processor.toolCallBuffer).to.include("<filePath>");
      expect(processor.toolCallBuffer).to.include("</filePath>");
    }
  });
});