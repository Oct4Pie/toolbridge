/**
 * OllamaLineJSONStreamProcessor - Comprehensive Unit Tests
 * 
 * Tests cover:
 * - Malformed JSON handling
 * - Partial JSON line accumulation
 * - Tool call detection in NDJSON format
 * - Buffer management
 */

import { expect } from "chai";
import { describe, it } from "mocha";
import { EventEmitter } from "events";

import { OllamaLineJSONStreamProcessor } from "../../handlers/stream/processors/OllamaLineJSONStreamProcessor.js";
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

    getContent(): string {
        return this.chunks.join("");
    }
}

const defaultTools: Tool[] = [
    { type: 'function', function: { name: "search", parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: "run_code", parameters: { type: 'object', properties: {} } } },
];

const createOllamaChunk = (response: string, done: boolean = false): string => {
    return JSON.stringify({
        model: "test-model",
        created_at: new Date().toISOString(),
        response,
        done,
    }) + "\n";
};

const hasToolCall = (chunks: string[], toolName?: string): boolean => {
    return chunks.some(chunk => {
        try {
            // For Ollama NDJSON, we may see SSE output after conversion
            if (chunk.startsWith("data: ")) {
                const data = chunk.substring(6).trim();
                if (data === "[DONE]") return false;
                const json = JSON.parse(data);
                const choice = json.choices?.[0];
                if (choice?.delta?.tool_calls) {
                    if (toolName) {
                        return choice.delta.tool_calls.some((tc: any) => tc.function?.name === toolName);
                    }
                    return true;
                }
            }
            return false;
        } catch {
            return false;
        }
    });
};

describe("OllamaLineJSONStreamProcessor - Comprehensive Tests", function () {
    this.timeout(10000);

    describe("Basic NDJSON Processing", function () {
        it("should process valid NDJSON chunks", function (done) {
            const mockRes = new MockResponse();
            const processor = new OllamaLineJSONStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            processor.processChunk(Buffer.from(createOllamaChunk("Hello ")));
            processor.processChunk(Buffer.from(createOllamaChunk("world!")));
            processor.processChunk(Buffer.from(createOllamaChunk("", true)));

            setTimeout(() => {
                const content = mockRes.getContent();
                expect(content).to.include("Hello");
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 100);
        });

        it("should handle done signal correctly", function (done) {
            const mockRes = new MockResponse();
            const processor = new OllamaLineJSONStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            processor.processChunk(Buffer.from(createOllamaChunk("Content", false)));
            processor.processChunk(Buffer.from(createOllamaChunk("", true)));

            setTimeout(() => {
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 100);
        });
    });

    describe("Malformed JSON Handling", function () {
        it("should handle invalid JSON gracefully", function (done) {
            const mockRes = new MockResponse();
            const processor = new OllamaLineJSONStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            processor.processChunk(Buffer.from("{invalid json}\n"));
            processor.processChunk(Buffer.from(createOllamaChunk("Valid after invalid")));
            processor.processChunk(Buffer.from(createOllamaChunk("", true)));

            setTimeout(() => {
                const content = mockRes.getContent();
                expect(content).to.include("Valid after invalid");
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 100);
        });

        it("should handle truncated JSON", function (done) {
            const mockRes = new MockResponse();
            const processor = new OllamaLineJSONStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            // Send partial JSON that gets completed in next chunk
            processor.processChunk(Buffer.from('{"model":"test","respon'));
            processor.processChunk(Buffer.from('se":"Hello","done":false}\n'));
            processor.processChunk(Buffer.from(createOllamaChunk("", true)));

            setTimeout(() => {
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 100);
        });

        it("should handle empty lines", function (done) {
            const mockRes = new MockResponse();
            const processor = new OllamaLineJSONStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            processor.processChunk(Buffer.from("\n\n"));
            processor.processChunk(Buffer.from(createOllamaChunk("Content")));
            processor.processChunk(Buffer.from("\n"));
            processor.processChunk(Buffer.from(createOllamaChunk("", true)));

            setTimeout(() => {
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 100);
        });
    });

    describe("Tool Call Detection in NDJSON", function () {
        it("should detect tool call in response field", function (done) {
            const mockRes = new MockResponse();
            const processor = new OllamaLineJSONStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            processor.processChunk(Buffer.from(createOllamaChunk("I'll search for that. ")));
            processor.processChunk(Buffer.from(createOllamaChunk("<search><query>test query</query></search>")));
            processor.processChunk(Buffer.from(createOllamaChunk("", true)));

            setTimeout(() => {
                const chunks = mockRes.getChunks();
                expect(hasToolCall(chunks, "search")).to.be.true;
                done();
            }, 100);
        });

        it("should detect tool call split across NDJSON chunks", function (done) {
            const mockRes = new MockResponse();
            const processor = new OllamaLineJSONStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            processor.processChunk(Buffer.from(createOllamaChunk("<sear")));
            processor.processChunk(Buffer.from(createOllamaChunk("ch><query>")));
            processor.processChunk(Buffer.from(createOllamaChunk("test</query>")));
            processor.processChunk(Buffer.from(createOllamaChunk("</search>")));
            processor.processChunk(Buffer.from(createOllamaChunk("", true)));

            setTimeout(() => {
                const chunks = mockRes.getChunks();
                expect(hasToolCall(chunks, "search")).to.be.true;
                done();
            }, 100);
        });
    });

    describe("Unicode and Special Characters", function () {
        it("should handle unicode in response", function (done) {
            const mockRes = new MockResponse();
            const processor = new OllamaLineJSONStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            processor.processChunk(Buffer.from(createOllamaChunk("你好世界 🌍")));
            processor.processChunk(Buffer.from(createOllamaChunk("<search><query>日本語テスト</query></search>")));
            processor.processChunk(Buffer.from(createOllamaChunk("", true)));

            setTimeout(() => {
                const chunks = mockRes.getChunks();
                expect(hasToolCall(chunks, "search")).to.be.true;
                done();
            }, 100);
        });

        it("should handle newlines in response content", function (done) {
            const mockRes = new MockResponse();
            const processor = new OllamaLineJSONStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            processor.processChunk(Buffer.from(createOllamaChunk("Line1\\nLine2\\nLine3")));
            processor.processChunk(Buffer.from(createOllamaChunk("", true)));

            setTimeout(() => {
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 100);
        });
    });

    describe("Buffer Management", function () {
        it("should handle very large response chunks", function (done) {
            const mockRes = new MockResponse();
            const processor = new OllamaLineJSONStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            const largeContent = "X".repeat(100000); // 100KB
            processor.processChunk(Buffer.from(createOllamaChunk(largeContent)));
            processor.processChunk(Buffer.from(createOllamaChunk("", true)));

            setTimeout(() => {
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 200);
        });

        it("should handle multiple rapid chunks", function (done) {
            const mockRes = new MockResponse();
            const processor = new OllamaLineJSONStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            for (let i = 0; i < 500; i++) {
                processor.processChunk(Buffer.from(createOllamaChunk(`Chunk ${i} `)));
            }
            processor.processChunk(Buffer.from(createOllamaChunk("", true)));

            setTimeout(() => {
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 200);
        });
    });

    describe("Concurrent Streams", function () {
        it("should maintain separate state for multiple instances", function (done) {
            const mockRes1 = new MockResponse();
            const mockRes2 = new MockResponse();
            const processor1 = new OllamaLineJSONStreamProcessor(mockRes1 as unknown as Response);
            const processor2 = new OllamaLineJSONStreamProcessor(mockRes2 as unknown as Response);

            processor1.setTools([{ type: 'function', function: { name: "tool_a", parameters: { type: 'object', properties: {} } } }]);
            processor2.setTools([{ type: 'function', function: { name: "tool_b", parameters: { type: 'object', properties: {} } } }]);

            // Interleave
            processor1.processChunk(Buffer.from(createOllamaChunk("<tool_a><p>1</p></tool_a>")));
            processor2.processChunk(Buffer.from(createOllamaChunk("<tool_b><p>2</p></tool_b>")));
            processor1.processChunk(Buffer.from(createOllamaChunk("", true)));
            processor2.processChunk(Buffer.from(createOllamaChunk("", true)));

            setTimeout(() => {
                expect(hasToolCall(mockRes1.getChunks(), "tool_a")).to.be.true;
                expect(hasToolCall(mockRes2.getChunks(), "tool_b")).to.be.true;
                done();
            }, 100);
        });
    });
});
