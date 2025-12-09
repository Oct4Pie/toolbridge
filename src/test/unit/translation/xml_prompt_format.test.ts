
import { expect } from 'chai';
import { formatToolsForBackendPromptXML } from '../../../translation/tools/promptUtils.js';
import type { OpenAITool } from '../../../types/index.js';

describe("Prompt Generation Manual Check", () => {
    it("generates correct XML prompt", () => {
        const mockTools: OpenAITool[] = [
            {
                type: 'function',
                function: {
                    name: 'get_weather',
                    description: 'Get current weather',
                    parameters: {
                        type: 'object',
                        properties: {
                            location: {
                                type: 'string',
                                description: 'City'
                            }
                        },
                        required: ['location']
                    }
                }
            }
        ];

        const prompt = formatToolsForBackendPromptXML(mockTools);
        console.log("\n--- GENERATED PROMPT ---\n");
        console.log(prompt);
        console.log("\n------------------------\n");

        expect(prompt).to.include("<toolbridge_calls>");
        expect(prompt).to.include("</toolbridge_calls>");
        expect(prompt).to.include("<tool_definition>");
        expect(prompt).to.include('name="location"');
    });
});
