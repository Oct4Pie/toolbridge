import { EventEmitter } from "events";

import { expect } from "chai";
import { describe, it } from "mocha";

import { OpenAIStreamProcessor } from "../../handlers/stream/openaiStreamProcessor.js";

import type { Response } from "express";

describe("Stream Error Handling Tests", function () {
  class MockResponse extends EventEmitter {
    private readonly chunks: string[];

    constructor() {
      super();
      this.chunks = [];
    }

    write(chunk: string): boolean {
      this.chunks.push(chunk);
      return true;
    }

    end(): void {
      this.emit("end");
    }

    getChunks(): string[] {
      return this.chunks;
    }
  }

  interface TestCase {
    name: string;
    chunks: string[];
  }

  const testCases: TestCase[] = [
    {
      name: "Handle a truncated JSON chunk",
      chunks: [
        'data: {"id":"test1","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"id":"test2","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: {"id":"test3","object":"chat.completion.chunk","created":12345,"model":"test-model","choices":[{"index":0,"delta":{"content":null},"finish_reason":"stop"}],"usage":{"prompt',
        '_tokens":123}}\n\n',
        "data: [DONE]\n\n",
      ],
    },
    {
      name: "Handle malformed JSON chunk",
      chunks: [
        'data: {"id":"test1","object":"chat.completion.chunk","choices":[{"delta":{"content":"Processing"}}]}\n\n',
        'data: {"id":"test2",object:"chat.completion.chunk","choices":[{"delta":{"content":" data"}}]}\n\n',
        'data: {"id":"test3","object":"chat.completion.chunk","choices":[{"delta":{"content":"..."}}]}\n\n',
        "data: [DONE]\n\n",
      ],
    },
  ];

  testCases.forEach((testCase) => {
    it(`should ${testCase.name}`, function (done) {
      const mockRes = new MockResponse();
      const processor = new OpenAIStreamProcessor(mockRes as Response);      testCase.chunks.forEach((chunk) => {
        try {
          processor.processChunk(chunk);
        } catch (e: unknown) {
          const error = e instanceof Error ? e : new Error(String(e));
          expect.fail(`Processor threw an unhandled exception: ${error.message}`);
        }
      });

      const responseChunks = mockRes.getChunks();
      expect(responseChunks.length).to.be.at.least(1);

      const allContent = responseChunks.join("");
      expect(allContent).to.not.be.empty;

      done();
    });
  });
});