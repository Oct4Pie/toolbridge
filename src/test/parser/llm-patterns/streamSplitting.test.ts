import { describe, it } from "mocha";
import { EventEmitter } from "events";

import { OpenAISSEStreamProcessor } from "../../../handlers/stream/processors/OpenAISSEStreamProcessor.js";
import type { Response } from "express";

interface Tool {
  type: 'function';
  function: {
    name: string;
    parameters: { type: 'object'; properties: Record<string, unknown> };
  };
}

class MockResponse extends EventEmitter {
  private chunks: string[] = [];
  public headersSent = false;
  public writableEnded = false;

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  end(): void {
    this.emit('end');
    this.writableEnded = true;
  }

  setHeader(_name: string, _value: string): void { }

  getChunks(): string[] {
    return this.chunks;
  }
}

describe("Stream Splitting LLM Pattern Tests", function () {
  this.timeout(5000);

  const hasToolCall = (chunks: string[], toolName?: string): boolean => {
    return chunks.some(chunk => {
      if (!chunk.startsWith("data: ")) return false;
      const data = chunk.substring(6).trim();
      if (data === "[DONE]") return false;
      try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        if (choice?.delta?.tool_calls) {
          const calls = choice.delta.tool_calls;
          if (toolName) {
            return calls.some((tc: any) => tc.function?.name === toolName);
          }
          return true;
        }
        return false;
      } catch (e) {
        return false;
      }
    });
  };

  const tools = [
    { type: 'function', function: { name: "search", parameters: { type: 'object', properties: {} } } } as Tool,
    { type: 'function', function: { name: "run_code", parameters: { type: 'object', properties: {} } } } as Tool,
    { type: 'function', function: { name: "think", parameters: { type: 'object', properties: {} } } } as Tool,
  ];

  it("should handle split tool calls across chunks", function (done) {
    const mockRes = new MockResponse();
    const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
    processor.setTools(tools);

    const inputs = [
      '{"id":"1","choices":[{"delta":{"content":"I\'ll search for that information."}}]}',
      '{"id":"2","choices":[{"delta":{"content":"<sea"}}]}',
      '{"id":"3","choices":[{"delta":{"content":"rch>"}}]}',
      '{"id":"4","choices":[{"delta":{"content":"<query>How"}}]}',
      '{"id":"5","choices":[{"delta":{"content":" to implement binary search?</query>"}}]}',
      '{"id":"6","choices":[{"delta":{"content":"</se"}}]}',
      '{"id":"7","choices":[{"delta":{"content":"arch>"}}]}',
    ];

    inputs.forEach((input) => processor.processChunk(Buffer.from(`data: ${input}\n\n`)));
    processor.end();

    setTimeout(() => {
      if (hasToolCall(mockRes.getChunks(), "search")) {
        done();
      } else {
        done(new Error("Tool call 'search' not detected"));
      }
    }, 100);
  });

  it("should handle LLM thinking before providing valid XML", function (done) {
    const mockRes = new MockResponse();
    const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
    processor.setTools(tools);

    const inputs = [
      '{"id":"1","choices":[{"delta":{"content":"Let me think about this problem..."}}]}',
      '{"id":"2","choices":[{"delta":{"content":"I need to search for information about sorting algorithms."}}]}',
      '{"id":"3","choices":[{"delta":{"content":"The best way to do this would be to use a search tool."}}]}',
      '{"id":"4","choices":[{"delta":{"content":"<search>"}}]}',
      '{"id":"5","choices":[{"delta":{"content":"<query>best sorting algorithms for large datasets</query>"}}]}',
      '{"id":"6","choices":[{"delta":{"content":"</search>"}}]}',
    ];

    inputs.forEach((input) => processor.processChunk(Buffer.from(`data: ${input}\n\n`)));
    processor.end();

    setTimeout(() => {
      if (hasToolCall(mockRes.getChunks(), "search")) {
        done();
      } else {
        done(new Error("Tool call 'search' not detected"));
      }
    }, 100);
  });

  it("should handle code explanations mixed with XML tool calls", function (done) {
    const mockRes = new MockResponse();
    const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
    processor.setTools(tools);

    const inputs = [
      '{"id":"1","choices":[{"delta":{"content":"Here\'s how you would implement a binary search in JavaScript:"}}]}',
      '{"id":"2","choices":[{"delta":{"content":"\\n```javascript\\nfunction binarySearch(arr, target) {\\n  let left = 0;\\n  let right = arr.length - 1;\\n  \\n  while (left <= right) {\\n    const mid = Math.floor((left + right) / 2);\\n    if (arr[mid] === target) return mid;\\n    if (arr[mid] < target) left = mid + 1;\\n    else right = mid - 1;\\n  }\\n  \\n  return -1;\\n}\\n```\\n"}}]}',
      '{"id":"3","choices":[{"delta":{"content":"Let me run this code to verify it works:"}}]}',
      '{"id":"4","choices":[{"delta":{"content":"<run"}}]}',
      '{"id":"5","choices":[{"delta":{"content":"_code>"}}]}',
      '{"id":"6","choices":[{"delta":{"content":"<language>javascript</language>"}}]}',
      '{"id":"7","choices":[{"delta":{"content":"<code>\\nfunction binarySearch(arr, target) {\\n  let left = 0;\\n  let right = arr.length - 1;\\n  \\n  while (left <= right) {\\n    const mid = Math.floor((left + right) / 2);\\n    if (arr[mid] === target) return mid;\\n    if (arr[mid] < target) left = mid + 1;\\n    else right = mid - 1;\\n  }\\n  \\n  return -1;\\n}\\n\\n// Test\\nconst arr = [1, 3, 5, 7, 9, 11];\\nconsole.log(binarySearch(arr, 5));\\nconsole.log(binarySearch(arr, 6));\\n</code>"}}]}',
      '{"id":"8","choices":[{"delta":{"content":"</run_code>"}}]}',
    ];

    inputs.forEach((input) => processor.processChunk(Buffer.from(`data: ${input}\n\n`)));
    processor.end();

    setTimeout(() => {
      if (hasToolCall(mockRes.getChunks(), "run_code")) {
        done();
      } else {
        done(new Error("Tool call 'run_code' not detected in code explanation"));
      }
    }, 100);
  });

  it("should handle extreme delays between XML parts", function (done) {
    const mockRes = new MockResponse();
    const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
    processor.setTools(tools);

    const chunk1 = '{"id":"1","choices":[{"delta":{"content":"<search><query>typescript generics"}}]}';
    processor.processChunk(Buffer.from(`data: ${chunk1}\n\n`));

    setTimeout(() => {
      const chunk2 = '{"id":"2","choices":[{"delta":{"content":" examples</query></search>"}}]}';
      processor.processChunk(Buffer.from(`data: ${chunk2}\n\n`));
      processor.end();

      setTimeout(() => {
        if (hasToolCall(mockRes.getChunks(), "search")) {
          done();
        } else {
          done(new Error("Tool call not detected with delay"));
        }
      }, 100);
    }, 1000);
  });
});