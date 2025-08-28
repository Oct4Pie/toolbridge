import { expect } from "chai";
import { describe, it } from "mocha";

import { OpenAIStreamProcessor } from "../../../handlers/stream/openaiStreamProcessor.js";

interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
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
    const processor = new OpenAIStreamProcessor(mockRes as Response);
    processor.setTools([
      {
        type: "function",
        function: { name: "test_tool", description: "Test tool" },
      } as Tool,
    ]);

    processor.processChunk('{"id": "123", "content": "Test content"}');
    processor.processChunk('{"id": "124", "content": "More content"}');

    const chunks = mockRes.getChunks();
    expect(chunks.length).to.be.at.least(1);

    const allContent = chunks.join("");
    expect(allContent).to.include("Test content");
    expect(allContent).to.include("More content");
  });
});