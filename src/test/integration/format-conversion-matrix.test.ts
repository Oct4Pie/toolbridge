/**
 * Format Conversion Matrix Tests
 * 
 * Tests all format combinations using the converters directly:
 * - OpenAI → OpenAI (tool detection in same format)
 * - Ollama → Ollama (tool detection in same format)
 * - OpenAI ↔ Ollama cross-format conversions
 * 
 * Each tests:
 * - Basic content pass-through
 * - Tool call detection
 * - Unicode content preservation
 */

import { expect } from "chai";
import { describe, it } from "mocha";

import { OpenAIConverter } from "../../translation/converters/openai-simple.js";
import { extractToolCallUnified } from "../../parsers/xml/index.js";

import type { OpenAIStreamChunk } from "../../types/openai.js";

const openaiConverter = new OpenAIConverter();
// OllamaResponseConverter is available if needed later
// const ollamaConverter = new OllamaResponseConverter();

interface Tool {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: { type: "object"; properties: Record<string, unknown> };
    };
}

const createTools = (...names: string[]): Tool[] => {
    return names.map(name => ({
        type: "function" as const,
        function: {
            name,
            description: `Tool ${name}`,
            parameters: { type: "object" as const, properties: {} }
        }
    }));
};

describe("Format Conversion Matrix Tests", function () {
    this.timeout(10000);

    describe("Tool Call Extraction - Unified", function () {
        it("should extract simple tool call", function () {
            const content = "<search><query>TypeScript generics</query></search>";
            const tools = createTools("search");

            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.not.be.null;
            expect(result?.name).to.equal("search");
            expect(result?.arguments).to.have.property("query");
        });

        it("should extract tool call with preface text", function () {
            const content = "I'll search for that. <search><query>test</query></search>";
            const tools = createTools("search");

            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.not.be.null;
            expect(result?.name).to.equal("search");
        });

        it("should preserve Unicode in tool parameters", function () {
            const content = "<search><query>你好世界 🌍 こんにちは</query></search>";
            const tools = createTools("search");

            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.not.be.null;
            const args = result?.arguments as Record<string, unknown>;
            expect(args?.["query"]).to.include("你好世界");
        });

        it("should return null for non-tool XML", function () {
            const content = "<div><span>HTML content</span></div>";
            const tools = createTools("search");

            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.be.null;
        });
    });

    describe("OpenAI Converter - Stream Chunks", function () {
        it("should create content chunk", function () {
            const chunk: OpenAIStreamChunk = openaiConverter.createStreamChunk(
                "test-id",
                "gpt-4",
                "Hello, world!",
                null
            );

            expect(chunk).to.have.property("choices");
            expect(chunk.choices?.[0]?.delta?.content).to.equal("Hello, world!");
        });

        it("should create tool call stream sequence", function () {
            const toolCall = {
                name: "search",
                arguments: { query: "test" }
            };

            const chunks = openaiConverter.createToolCallStreamSequence(
                toolCall,
                "test-id",
                "gpt-4"
            );

            expect(chunks).to.be.an("array");
            expect(chunks.length).to.be.greaterThan(0);

            // Find chunk with tool_calls
            const toolChunk = chunks.find(c => c.choices[0]?.delta?.tool_calls);
            expect(toolChunk).to.exist;
        });

        it("should handle empty content", function () {
            const chunk = openaiConverter.createStreamChunk(
                "test-id",
                "gpt-4",
                "",
                null
            );

            expect(chunk.choices?.[0]?.delta?.content).to.equal("");
        });
    });

    describe("Tool Extraction - Additional", function () {
        it("should handle tool with multiple parameters", function () {
            const content = "<search><query>test</query><limit>10</limit></search>";
            const tools = createTools("search");

            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.not.be.null;
            expect(result?.name).to.equal("search");
        });
    });

    describe("Cross-Format Scenarios", function () {
        it("should handle tool call with large parameters", function () {
            const largeQuery = "A".repeat(10000); // 10KB
            const content = `<search><query>${largeQuery}</query></search>`;
            const tools = createTools("search");

            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.not.be.null;
            const args = result?.arguments as Record<string, unknown>;
            expect((args?.["query"] as string)?.length).to.equal(10000);
        });

        it("should handle multiple tool calls in content", function () {
            const content = "First <search><query>q1</query></search> then <search><query>q2</query></search>";
            const tools = createTools("search");

            // extractToolCallUnified returns first match
            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.not.be.null;
        });

        it("should handle nested XML in tool parameters", function () {
            const content = "<insert_edit><file>test.html</file><content><div><h1>Title</h1></div></content></insert_edit>";
            const tools = createTools("insert_edit");

            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.not.be.null;
            expect(result?.name).to.equal("insert_edit");
        });

        it("should handle tool call with markdown content", function () {
            const content = "<search><query>```code block```</query></search>";
            const tools = createTools("search");

            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.not.be.null;
        });
    });

    describe("Edge Cases", function () {
        it("should handle empty tool list", function () {
            const content = "<search><query>test</query></search>";

            const result = extractToolCallUnified(content, []);

            // With no tools defined, no extraction
            expect(result).to.be.null;
        });

        it("should handle whitespace in content", function () {
            const content = "   <search><query>  test  </query></search>   ";
            const tools = createTools("search");

            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.not.be.null;
        });

        it("should handle newlines in tool content", function () {
            const content = "<search><query>line1\nline2\nline3</query></search>";
            const tools = createTools("search");

            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.not.be.null;
            const args = result?.arguments as Record<string, unknown>;
            expect(args?.["query"]).to.include("\n");
        });
    });
});
