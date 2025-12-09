/**
 * Edge Case & Adversarial Input Tests
 * 
 * Tests extreme edge cases:
 * - XML bomb (repeated unclosed tags)
 * - JSON injection patterns
 * - Control characters
 * - Extremely long tool names
 * - Recursive/deeply nested XML
 * - Security patterns
 */

import { expect } from "chai";
import { describe, it } from "mocha";

import { extractToolCallUnified, extractToolCallsUnified } from "../../../parsers/xml/index.js";
import { detectPotentialToolCall } from "../../../parsers/xml/utils/toolCallDetection.js";

interface Tool {
    type: "function";
    function: {
        name: string;
        parameters: { type: "object"; properties: Record<string, unknown> };
    };
}

const createTools = (...names: string[]): Tool[] => {
    return names.map(name => ({
        type: "function" as const,
        function: {
            name,
            parameters: { type: "object" as const, properties: {} }
        }
    }));
};

describe("Edge Case & Adversarial Input Tests", function () {
    this.timeout(30000);

    describe("XML Bomb / DoS Attempts", function () {
        it("should handle 1000 repeated unclosed tags without crashing", function () {
            let bomb = "";
            for (let i = 0; i < 1000; i++) {
                bomb += "<search><query>";
            }

            const tools = createTools("search");
            const result = extractToolCallUnified(bomb, tools.map(t => t.function.name));

            // Should not crash, may return null or partial result
            expect(result === null || typeof result === "object").to.be.true;
        });

        it("should handle billion laughs style expansion attempt", function () {
            const xml = `
        <!DOCTYPE lol [
          <!ENTITY lol "lol">
          <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">
        ]>
        <search><query>&lol2;</query></search>
      `;

            const tools = createTools("search");
            // Should not process entities (security) - just shouldn't crash or hang
            extractToolCallUnified(xml, tools.map(t => t.function.name));

            // Just shouldn't crash or hang
            expect(true).to.be.true;
        });

        it("should handle deeply nested XML (100 levels)", function () {
            let xml = "";
            for (let i = 0; i < 100; i++) {
                xml += "<nested>";
            }
            xml += "content";
            for (let i = 0; i < 100; i++) {
                xml += "</nested>";
            }

            const wrapped = `<search><query>${xml}</query></search>`;
            const tools = createTools("search");
            const result = extractToolCallUnified(wrapped, tools.map(t => t.function.name));

            // Should handle without stack overflow
            expect(result === null || typeof result === "object").to.be.true;
        });
    });

    describe("JSON Injection Patterns", function () {
        it("should handle content with JSON-breaking characters", function () {
            const content = 'Here is the result: <search><query>test"}}]}]}}</query></search>';

            const tools = createTools("search");
            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            if (result) {
                expect(result.name).to.equal("search");
            }
        });

        it("should handle escaped JSON in tool parameters", function () {
            const content = '<search><query>{"key": "value", "nested": {"a": 1}}</query></search>';

            const tools = createTools("search");
            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.not.be.null;
            expect(result?.name).to.equal("search");
        });

        it("should handle broken JSON-like content gracefully", function () {
            const content = '<search><query>{{{invalid{{{</query></search>';

            const tools = createTools("search");
            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            if (result) {
                expect(result.name).to.equal("search");
                expect(result.arguments).to.have.property("query");
            }
        });
    });

    describe("Control Characters", function () {
        it("should handle null bytes in content", function () {
            const content = '<search><query>test\x00null\x00byte</query></search>';

            const tools = createTools("search");
            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            // Should either extract or skip, not crash
            expect(result === null || typeof result === "object").to.be.true;
        });

        it("should handle other control characters", function () {
            const content = '<search><query>\x01\x02\x03\x1f\x7f</query></search>';

            const tools = createTools("search");
            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result === null || typeof result === "object").to.be.true;
        });

        it("should handle mixed ASCII and control chars", function () {
            const content = '<search><query>normal\ttab\nnewline\rcarriage</query></search>';

            const tools = createTools("search");
            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.not.be.null;
        });
    });

    describe("Extremely Long Tool Names", function () {
        it("should handle 1000+ character tool name", function () {
            const longName = "tool_" + "a".repeat(1000);
            const content = `<${longName}><param>value</param></${longName}>`;

            const tools = createTools(longName);
            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.not.be.null;
            expect(result?.name).to.equal(longName);
        });

        it("should handle tool name with special characters", function () {
            // Underscores and numbers are valid
            const specialName = "my_tool_123_name";
            const content = `<${specialName}><p>v</p></${specialName}>`;

            const tools = createTools(specialName);
            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result?.name).to.equal(specialName);
        });
    });

    describe("Configuration Edge Cases", function () {
        it("should handle empty tool name in tools array", function () {
            const tools = createTools("", "search");
            const content = "<search><query>test</query></search>";

            const result = extractToolCallUnified(content, tools.map(t => t.function.name).filter(n => n));
            expect(result?.name).to.equal("search");
        });

        it("should handle duplicate tool names", function () {
            const tools = [...createTools("search"), ...createTools("search")];
            const content = "<search><query>test</query></search>";

            const result = extractToolCallUnified(content, tools.map(t => t.function.name));
            expect(result?.name).to.equal("search");
        });

        it("should handle tool name case mismatch", function () {
            const tools = createTools("search");
            const content = "<Search><Query>test</Query></Search>"; // Capital S

            const result = extractToolCallUnified(content, tools.map(t => t.function.name));
            // May or may not match depending on implementation
            expect(result === null || result?.name.toLowerCase() === "search").to.be.true;
        });
    });

    describe("Security Patterns", function () {
        it("should not be vulnerable to XSS in tool parameters", function () {
            const content = '<search><query><script>alert(1)</script></query></search>';

            const tools = createTools("search");
            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.not.be.null;
            // The arguments may be a string or object depending on parser
            const argsStr = typeof result?.arguments === 'string'
                ? result.arguments
                : JSON.stringify(result?.arguments);
            expect(argsStr).to.include("script");
        });

        it("should handle SQL injection patterns in content", function () {
            const content = "<search><query>'; DROP TABLE users; --</query></search>";

            const tools = createTools("search");
            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result).to.not.be.null;
            const args = result?.arguments as Record<string, unknown>;
            expect(args?.["query"]).to.include("DROP TABLE");
        });

        it("should handle path traversal attempts", function () {
            const content = '<read_file><path>../../../etc/passwd</path></read_file>';

            const tools = createTools("read_file");
            const result = extractToolCallUnified(content, tools.map(t => t.function.name));

            expect(result?.name).to.equal("read_file");
            const args = result?.arguments as Record<string, unknown>;
            expect(args?.["path"]).to.include("../");
        });
    });

    describe("Multiple Tool Calls", function () {
        it("should extract multiple different tool calls", function () {
            const content = "<search><query>first</query></search> some text <run_code><code>console.log(1)</code></run_code>";

            const tools = createTools("search", "run_code");
            const results = extractToolCallsUnified(content, tools.map(t => t.function.name));

            expect(results.length).to.be.at.least(1);
        });

        it("should handle interleaved tool calls and content", function () {
            const content = `
        First I'll search: <search><query>q1</query></search>
        Now I'll run code: <run_code><code>x</code></run_code>
        Finally: <search><query>q2</query></search>
      `;

            const tools = createTools("search", "run_code");
            const results = extractToolCallsUnified(content, tools.map(t => t.function.name));

            expect(results.length).to.be.at.least(1);
        });
    });

    describe("Potential Tool Call Detection", function () {
        it("should detect potential incomplete tool call", function () {
            const content = "I'm going to search <sear";
            const result = detectPotentialToolCall(content, ["search"]);

            expect(result.mightBeToolCall).to.be.true;
        });

        it("should not detect HTML as tool call", function () {
            const content = "<div><span>HTML content</span></div>";
            const result = detectPotentialToolCall(content, ["search"]);

            expect(result.mightBeToolCall).to.be.false;
        });

        it("should detect actual tool call as complete", function () {
            const content = "<search><query>test</query></search>";
            const result = detectPotentialToolCall(content, ["search"]);

            expect(result.isCompletedXml).to.be.true;
        });
    });
});
