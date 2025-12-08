
import { expect } from "chai";
import { describe, it } from "mocha";
import { translationService } from "../../services/translationService.js";
import { configService } from "../../services/configService.js";

import type { OpenAIRequest } from "../../types/openai.js";

describe("OpenAI Service Verification", () => {
    it("Enforces passTools: false for OpenAI -> OpenAI pipeline", async () => {
        // 1. Verify Config SSOT
        expect(configService.shouldPassTools()).to.be.false;

        // 2. Prepare OpenAI Request
        const request: OpenAIRequest = {
            model: "gpt-4",
            messages: [
                { role: "system", content: "Original system message" },
                { role: "user", content: "Hello" }
            ],
            tools: [
                {
                    type: "function",
                    function: {
                        name: "test_tool",
                        description: "A test tool",
                        parameters: { type: "object", properties: {} }
                    }
                }
            ],
            tool_choice: "auto"
        };

        // 3. Translate
        // format: openai -> openai
        // Note: translationService uses 'openai' and 'ollama' based on headers/urls normally,
        // but here we can check the internal translation logic if we can access the engine.
        // Actually, translationService.translateRequest takes (request, fromFormat, toFormat).

        const result = await translationService.translateRequest(
            request,
            "openai",
            "openai",
            ["test_tool"]
        );

        // 4. Verification
        const output = result as OpenAIRequest;

        // A. Tools must be stripped
        expect(output.tools, "Tools should be undefined").to.be.undefined;
        expect(output.tool_choice, "Tool choice should be undefined").to.be.undefined;

        // B. System message must be modified
        const systemMsg = output.messages.find(m => m.role === "system");
        expect(systemMsg).to.not.be.undefined;
        expect(systemMsg?.content).to.include("# TOOL USE CONFIGURATION"); // From our new prompt
        expect(systemMsg?.content).to.include("STRICT XML MODE");
        expect(systemMsg?.content).to.include("<tool_definition>");
        expect(systemMsg?.content).to.include("Original system message"); // Should preserve original

        console.log("Verified OpenAI -> OpenAI translation success.");
    });
});
