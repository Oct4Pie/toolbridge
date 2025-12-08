
import { expect } from "chai";
import { describe, it } from "mocha";
import { translationService } from "../../services/translationService.js";
import { configService } from "../../services/configService.js";

import type { OpenAIRequest } from "../../types/openai.js";
import type { OllamaRequest } from "../../types/ollama.js";

describe("Ollama Backend Verification", () => {
    it("Enforces passTools: false for OpenAI -> Ollama pipeline", async () => {
        // 1. Verify Config SSOT
        expect(configService.shouldPassTools()).to.be.false;

        // 2. Prepare OpenAI Request (Client sends OpenAI format)
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
        // format: openai (client) -> ollama (backend)
        const result = await translationService.translateRequest(
            request,
            "openai",
            "ollama",
            ["test_tool"]
        );

        // 4. Verification
        const output = result as OllamaRequest;

        // A. Tools must be stripped (Ollama request has no tools)
        expect(output.tools, "Tools should be undefined").to.be.undefined;

        // B. Options should be set (basic checks)
        // expect(output.stream).to.be.undefined; // or check specific options if set

        // C. System message must be modified
        const systemMsg = output.messages?.find(m => m.role === "system");
        expect(systemMsg).to.not.be.undefined;
        expect(systemMsg?.content).to.include("# TOOL USE CONFIGURATION");
        expect(systemMsg?.content).to.include("STRICT XML MODE");
        expect(systemMsg?.content).to.include("<tool_definition>");
        expect(systemMsg?.content).to.include("Original system message");

        console.log("Verified OpenAI -> Ollama translation success.");
    });
});
