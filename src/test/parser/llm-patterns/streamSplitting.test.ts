import { describe, it } from "mocha";

import { OpenAIStreamProcessor } from "../../../handlers/stream/openaiStreamProcessor.js";

interface MockResponse {
  write: () => void;
  end: () => void;
  setHeader: () => void;
  headersSent: boolean;
  writableEnded: boolean;
}

interface Tool {
  function: {
    name: string;
  };
}

describe("Stream Splitting LLM Pattern Tests", function () {
  this.timeout(5000);

  it("should handle split tool calls across chunks", function () {
    const mockRes = {
      write: () => {},
      end: () => {},
      setHeader: () => {},
      headersSent: false,
      writableEnded: false,
    };

    const processor = new OpenAIStreamProcessor(mockRes as any);
    processor.setTools([
      { function: { name: "search" } } as Tool,
      { function: { name: "run_code" } } as Tool,
      { function: { name: "think" } } as Tool,
    ]);

    let toolCallDetected = false;

    processor.handleDetectedToolCall = () => {
      toolCallDetected = true;
      return true;
    };

    const chunks = [
      '{"id":"1","choices":[{"delta":{"content":"I\'ll search for that information."}}]}',
      '{"id":"2","choices":[{"delta":{"content":"<sea"}}]}',
      '{"id":"3","choices":[{"delta":{"content":"rch>"}}]}',
      '{"id":"4","choices":[{"delta":{"content":"<query>How"}}]}',
      '{"id":"5","choices":[{"delta":{"content":" to implement binary search?</query>"}}]}',
      '{"id":"6","choices":[{"delta":{"content":"</se"}}]}',
      '{"id":"7","choices":[{"delta":{"content":"arch>"}}]}',
    ];

    chunks.forEach((chunk) => {
      processor.processChunk(Buffer.from(chunk));
    });

    processor.end();

    setTimeout(() => {
      if (toolCallDetected) {
        done();
      } else {
        done(new Error("Tool call not detected"));
      }
    }, 100);
  });

  it("should handle LLM thinking before providing valid XML", function (done) {
    const mockRes: MockResponse = {
      write: () => {},
      end: () => {},
      setHeader: () => {},
      headersSent: false,
      writableEnded: false,
    };

    const processor = new OpenAIStreamProcessor(mockRes as any);
    processor.setTools([
      { function: { name: "search" } } as Tool,
      { function: { name: "run_code" } } as Tool,
      { function: { name: "think" } } as Tool,
    ]);

    let toolCallDetected = false;
    processor.handleDetectedToolCall = () => {
      toolCallDetected = true;
      return true;
    };

    const chunks = [
      '{"id":"1","choices":[{"delta":{"content":"Let me think about this problem..."}}]}',
      '{"id":"2","choices":[{"delta":{"content":"I need to search for information about sorting algorithms."}}]}',
      '{"id":"3","choices":[{"delta":{"content":"The best way to do this would be to use a search tool."}}]}',
      '{"id":"4","choices":[{"delta":{"content":"<search>"}}]}',
      '{"id":"5","choices":[{"delta":{"content":"<query>best sorting algorithms for large datasets</query>"}}]}',
      '{"id":"6","choices":[{"delta":{"content":"</search>"}}]}',
    ];

    chunks.forEach((chunk) => processor.processChunk(Buffer.from(chunk)));
    processor.end();

    setTimeout(() => {
      if (toolCallDetected) {
        done();
      } else {
        done(new Error("Tool call not detected after thinking"));
      }
    }, 100);
  });

  it("should handle code explanations mixed with XML tool calls", function (done) {
    const mockRes: MockResponse = {
      write: () => {},
      end: () => {},
      setHeader: () => {},
      headersSent: false,
      writableEnded: false,
    };

    const processor = new OpenAIStreamProcessor(mockRes as any);
    processor.setTools([
      { function: { name: "search" } } as Tool,
      { function: { name: "run_code" } } as Tool,
      { function: { name: "think" } } as Tool,
    ]);

    let toolCallDetected = false;
    processor.handleDetectedToolCall = () => {
      toolCallDetected = true;
      return true;
    };

    const chunks = [
      '{"id":"1","choices":[{"delta":{"content":"Here\'s how you would implement a binary search in JavaScript:"}}]}',
      '{"id":"2","choices":[{"delta":{"content":"\n```javascript\nfunction binarySearch(arr, target) {\n  let left = 0;\n  let right = arr.length - 1;\n  \n  while (left <= right) {\n    const mid = Math.floor((left + right) / 2);\n    if (arr[mid] === target) return mid;\n    if (arr[mid] < target) left = mid + 1;\n    else right = mid - 1;\n  }\n  \n  return -1;\n}\n```\n"}}]}',
      '{"id":"3","choices":[{"delta":{"content":"Let me run this code to verify it works:"}}]}',
      '{"id":"4","choices":[{"delta":{"content":"<run"}}]}',
      '{"id":"5","choices":[{"delta":{"content":"_code>"}}]}',
      '{"id":"6","choices":[{"delta":{"content":"<language>javascript</language>"}}]}',
      '{"id":"7","choices":[{"delta":{"content":"<code>\nfunction binarySearch(arr, target) {\n  let left = 0;\n  let right = arr.length - 1;\n  \n  while (left <= right) {\n    const mid = Math.floor((left + right) / 2);\n    if (arr[mid] === target) return mid;\n    if (arr[mid] < target) left = mid + 1;\n    else right = mid - 1;\n  }\n  \n  return -1;\n}\n\n// Test\nconst arr = [1, 3, 5, 7, 9, 11];\nconsole.log(binarySearch(arr, 5));\nconsole.log(binarySearch(arr, 6));\n</code>"}}]}',
      '{"id":"8","choices":[{"delta":{"content":"</run_code>"}}]}',
    ];

    chunks.forEach((chunk) => processor.processChunk(Buffer.from(chunk)));
    processor.end();

    setTimeout(() => {
      if (toolCallDetected) {
        done();
      } else {
        done(new Error("Tool call not detected in code explanation"));
      }
    }, 100);
  });

  it("should handle extreme delays between XML parts", function (done) {
    const mockRes: MockResponse = {
      write: () => {},
      end: () => {},
      setHeader: () => {},
      headersSent: false,
      writableEnded: false,
    };

    const processor = new OpenAIStreamProcessor(mockRes as any);
    processor.setTools([
      { function: { name: "search" } } as Tool,
      { function: { name: "run_code" } } as Tool,
    ]);

    let toolCallDetected = false;
    processor.handleDetectedToolCall = () => {
      toolCallDetected = true;
      return true;
    };

    const chunk1 =
      '{"id":"1","choices":[{"delta":{"content":"<search><query>typescript generics"}}]}';
    processor.processChunk(Buffer.from(chunk1));

    setTimeout(() => {
      const chunk2 =
        '{"id":"2","choices":[{"delta":{"content":" examples</query></search>"}}]}';
      processor.processChunk(Buffer.from(chunk2));
      processor.end();

      setTimeout(() => {
        if (toolCallDetected) {
          done();
        } else {
          done(new Error("Tool call not detected with delay"));
        }
      }, 100);
    }, 1000);
  });
});