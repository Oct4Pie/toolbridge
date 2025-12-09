/**
 * OpenAISSEStreamProcessor - Comprehensive Unit Tests
 * 
 * Tests cover:
 * - Buffer overflow protection
 * - Malformed SSE handling
 * - Interrupted tool calls
 * - Unicode edge cases
 * - Concurrent streams
 */

import { expect } from "chai";
import { describe, it } from "mocha";
import { EventEmitter } from "events";

import { OpenAISSEStreamProcessor } from "../../handlers/stream/processors/OpenAISSEStreamProcessor.js";
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
    { type: 'function', function: { name: "analyze", parameters: { type: 'object', properties: {} } } },
];

const createChunk = (id: string, content: string): string => {
    return `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created: Date.now(),
        model: "test-model",
        choices: [{ index: 0, delta: { content }, finish_reason: null }]
    })}\n\n`;
};

const hasToolCall = (chunks: string[], toolName?: string): boolean => {
    return chunks.some(chunk => {
        if (!chunk.startsWith("data: ")) return false;
        const data = chunk.substring(6).trim();
        if (data === "[DONE]") return false;
        try {
            const json = JSON.parse(data);
            const choice = json.choices?.[0];
            if (choice?.delta?.tool_calls) {
                if (toolName) {
                    return choice.delta.tool_calls.some((tc: any) => tc.function?.name === toolName);
                }
                return true;
            }
            return false;
        } catch {
            return false;
        }
    });
};

const containsRawXML = (content: string): boolean => {
    // Check for raw XML tags that should have been converted to tool calls
    return /<(search|run_code|think)>/.test(content) && /<\/(search|run_code|think)>/.test(content);
};

describe("OpenAISSEStreamProcessor - Comprehensive Tests", function () {
    this.timeout(10000);

    describe("Buffer Overflow Protection", function () {
        it("should handle large content without tool calls", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            // Send 1000 chunks of ~1KB each (approx 1MB total)
            for (let i = 0; i < 1000; i++) {
                const content = `Chunk ${i}: ${"A".repeat(1000)}`;
                processor.processChunk(Buffer.from(createChunk(`chunk-${i}`, content)));
            }

            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                const chunks = mockRes.getChunks();
                expect(chunks.length).to.be.greaterThan(100);
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 100);
        });

        it("should trim buffer when exceeding max size during tool detection", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            // Start a potential tool call
            processor.processChunk(Buffer.from(createChunk("1", "<sea")));

            // Send a lot of content that looks like it MIGHT complete the tool call
            for (let i = 0; i < 100; i++) {
                processor.processChunk(Buffer.from(createChunk(`${i + 2}`, "partial content...")));
            }

            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                // Should not crash, should end gracefully
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 100);
        });
    });

    describe("Malformed SSE Handling", function () {
        it("should ignore lines without data: prefix", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            // Send malformed lines mixed with valid ones
            processor.processChunk(Buffer.from("invalid line without prefix\n"));
            processor.processChunk(Buffer.from(createChunk("1", "Valid content")));
            processor.processChunk(Buffer.from("another bad line\n"));
            processor.processChunk(Buffer.from(createChunk("2", " more valid")));
            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                const content = mockRes.getContent();
                expect(content).to.include("Valid content");
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 100);
        });

        it("should handle SSE comments gracefully", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            processor.processChunk(Buffer.from(": This is an SSE comment\n"));
            processor.processChunk(Buffer.from(createChunk("1", "Content after comment")));
            processor.processChunk(Buffer.from(": Another comment\n"));
            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                const content = mockRes.getContent();
                expect(content).to.include("Content after comment");
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 100);
        });

        it("should handle malformed JSON in data line", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            processor.processChunk(Buffer.from("data: {malformed json without quotes}\n\n"));
            processor.processChunk(Buffer.from(createChunk("1", "Valid after malformed")));
            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                // Should not crash, should continue processing
                const content = mockRes.getContent();
                expect(content).to.include("Valid after malformed");
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 100);
        });
    });

    describe("Interrupted Tool Calls", function () {
        it("should finalize partial tool call on [DONE]", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            // Start tool call but don't complete it
            processor.processChunk(Buffer.from(createChunk("1", "<search><query>test query")));
            // Send DONE before closing tag
            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                // Should attempt to finalize - may emit partial content or tool call depending on implementation
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 100);
        });

        it("should handle tool call split then abandoned", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            processor.processChunk(Buffer.from(createChunk("1", "Thinking about this...")));
            processor.processChunk(Buffer.from(createChunk("2", "<thi")));
            // Now send regular content instead of completing tool call
            processor.processChunk(Buffer.from(createChunk("3", "Actually, let me just explain...")));
            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                expect(mockRes.writableEnded).to.be.true;
                // Content should be present
                const content = mockRes.getContent();
                expect(content.length).to.be.greaterThan(0);
                done();
            }, 100);
        });
    });

    describe("Unicode Edge Cases", function () {
        it("should handle emoji in content", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            processor.processChunk(Buffer.from(createChunk("1", "Here's a search 🔍")));
            processor.processChunk(Buffer.from(createChunk("2", "<search><query>emoji test 🚀💻😀</query></search>")));
            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                const chunks = mockRes.getChunks();
                expect(hasToolCall(chunks, "search")).to.be.true;
                done();
            }, 100);
        });

        it("should handle CJK characters", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            processor.processChunk(Buffer.from(createChunk("1", "让我搜索一下")));
            processor.processChunk(Buffer.from(createChunk("2", "<search><query>你好世界 こんにちは 안녕하세요</query></search>")));
            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                const chunks = mockRes.getChunks();
                expect(hasToolCall(chunks, "search")).to.be.true;
                done();
            }, 100);
        });

        it("should handle RTL text", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            processor.processChunk(Buffer.from(createChunk("1", "مرحبا بالعالم")));
            processor.processChunk(Buffer.from(createChunk("2", "<search><query>שלום עולם</query></search>")));
            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                const chunks = mockRes.getChunks();
                expect(hasToolCall(chunks, "search")).to.be.true;
                done();
            }, 100);
        });
    });

    describe("Tool Call Detection Accuracy", function () {
        it("should detect complete tool call and NOT emit raw XML", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            processor.processChunk(Buffer.from(createChunk("1", "I'll search for that.")));
            processor.processChunk(Buffer.from(createChunk("2", "<search><query>TypeScript generics</query></search>")));
            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                const chunks = mockRes.getChunks();
                const content = mockRes.getContent();

                // Should have tool call
                expect(hasToolCall(chunks, "search")).to.be.true;

                // Should NOT contain raw XML
                expect(containsRawXML(content)).to.be.false;

                done();
            }, 100);
        });

        it("should detect tool call split across many chunks", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            // Split tool call into many small pieces
            const parts = ["<", "se", "ar", "ch", ">", "<", "qu", "er", "y", ">", "te", "st", "</", "que", "ry", ">", "</", "sea", "rch", ">"];
            parts.forEach((part, i) => {
                processor.processChunk(Buffer.from(createChunk(`${i}`, part)));
            });
            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                const chunks = mockRes.getChunks();
                expect(hasToolCall(chunks, "search")).to.be.true;
                done();
            }, 100);
        });

        it("should handle nested XML in tool call parameters", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            processor.setTools([
                { type: 'function', function: { name: "insert_edit", parameters: { type: 'object', properties: {} } } },
            ]);

            const xmlContent = "<insert_edit><file>test.html</file><content><div><h1>Title</h1><p>Content</p></div></content></insert_edit>";
            processor.processChunk(Buffer.from(createChunk("1", xmlContent)));
            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                const chunks = mockRes.getChunks();
                expect(hasToolCall(chunks, "insert_edit")).to.be.true;
                done();
            }, 100);
        });
    });

    describe("Concurrent Streams (State Isolation)", function () {
        it("should maintain separate state for multiple processor instances", function (done) {
            const mockRes1 = new MockResponse();
            const mockRes2 = new MockResponse();
            const processor1 = new OpenAISSEStreamProcessor(mockRes1 as unknown as Response);
            const processor2 = new OpenAISSEStreamProcessor(mockRes2 as unknown as Response);

            processor1.setTools([{ type: 'function', function: { name: "tool_a", parameters: { type: 'object', properties: {} } } }]);
            processor2.setTools([{ type: 'function', function: { name: "tool_b", parameters: { type: 'object', properties: {} } } }]);

            // Interleave processing
            processor1.processChunk(Buffer.from(createChunk("1", "<tool_a>")));
            processor2.processChunk(Buffer.from(createChunk("1", "Regular content")));
            processor1.processChunk(Buffer.from(createChunk("2", "<query>test</query>")));
            processor2.processChunk(Buffer.from(createChunk("2", "<tool_b><param>value</param></tool_b>")));
            processor1.processChunk(Buffer.from(createChunk("3", "</tool_a>")));

            processor1.processChunk(Buffer.from("data: [DONE]\n\n"));
            processor2.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                // Processor 1 should detect tool_a
                expect(hasToolCall(mockRes1.getChunks(), "tool_a")).to.be.true;
                // Processor 2 should detect tool_b
                expect(hasToolCall(mockRes2.getChunks(), "tool_b")).to.be.true;
                done();
            }, 100);
        });
    });

    describe("Edge Cases from Verification Plan", function () {
        it("should handle XML bomb (repeated unclosed tags)", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            // XML bomb: many unclosed tags
            let bomb = "";
            for (let i = 0; i < 100; i++) {
                bomb += "<search><query>";
            }
            processor.processChunk(Buffer.from(createChunk("1", bomb)));
            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                // Should not crash, should end gracefully
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 100);
        });

        it("should handle no tools defined", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            // Don't set tools - empty array

            processor.processChunk(Buffer.from(createChunk("1", "Content with <search><query>test</query></search> XML")));
            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                // Should not crash, content should pass through
                expect(mockRes.writableEnded).to.be.true;
                const content = mockRes.getContent();
                expect(content).to.include("<search>");
                done();
            }, 100);
        });

        it("should handle extremely long tool parameters", function (done) {
            const mockRes = new MockResponse();
            const processor = new OpenAISSEStreamProcessor(mockRes as unknown as Response);
            processor.setTools(defaultTools);

            const longQuery = "A".repeat(50000); // 50KB query
            processor.processChunk(Buffer.from(createChunk("1", `<search><query>${longQuery}</query></search>`)));
            processor.processChunk(Buffer.from("data: [DONE]\n\n"));

            setTimeout(() => {
                expect(mockRes.writableEnded).to.be.true;
                done();
            }, 500);
        });
    });
});
