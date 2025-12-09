import { expect } from "chai";
import { describe, it } from "mocha";

import { OpenAISSEStreamProcessor } from "../../../handlers/stream/processors/OpenAISSEStreamProcessor.js";

import type { Response } from "express";

interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: { type: 'object'; properties: Record<string, unknown> };
  };
}

class MockResponse {
  private readonly chunks: string[];
  public ended: boolean;
  public writableEnded: boolean;

  constructor() {
    this.chunks = [];
    this.ended = false;
    this.writableEnded = false;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  setHeader(_name: string, _value: string): void { }

  end(): void {
    this.ended = true;
    this.writableEnded = true;
  }

  getChunks(): string[] {
    return this.chunks;
  }
}

describe("Text Duplication Test", function () {
  it("should handle text duplication properly", function () {
    const mockRes = new MockResponse();
    const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
    processor.setTools([
      {
        type: "function",
        function: { name: "test_tool", description: "Test tool", parameters: { type: 'object', properties: {} } },
      } as Tool,
    ]);

    // Send valid SSE chunks with OpenAI structure
    const chunk1 = {
      id: "123",
      choices: [{ delta: { content: "Test content" } }]
    };
    const chunk2 = {
      id: "124",
      choices: [{ delta: { content: "More content" } }]
    };

    processor.processChunk(Buffer.from(`data: ${JSON.stringify(chunk1)}\n\n`));
    processor.processChunk(Buffer.from(`data: ${JSON.stringify(chunk2)}\n\n`));

    const chunks = mockRes.getChunks();
    expect(chunks.length).to.be.at.least(1);

    const allContent = chunks.join("");
    // The processor emits SSE strings. We check if the content is inside them.
    expect(allContent).to.include("Test content");
    expect(allContent).to.include("More content");
  });
});