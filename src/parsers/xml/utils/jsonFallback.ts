
import { logger } from "../../../logging/index.js";
import type { ExtractedToolCall } from "../../../types/index.js";

/**
 * Extract balanced JSON object from text starting at a specific index
 */
function extractBalancedJSON(text: string, startIndex: number): string | null {
    let braceCount = 0;
    let inString = false;
    let escape = false;
    let started = false;
    let endIndex = -1;

    for (let i = startIndex; i < text.length; i++) {
        const char = text[i];

        if (escape) {
            escape = false;
            continue;
        }

        if (char === '\\') {
            escape = true;
            continue;
        }

        if (char === '"' && !escape) {
            inString = !inString;
            continue;
        }

        if (!inString) {
            if (char === '{') {
                braceCount++;
                started = true;
            } else if (char === '}') {
                braceCount--;
                if (started && braceCount === 0) {
                    endIndex = i + 1;
                    break;
                }
            }
        }
    }

    if (endIndex !== -1) {
        return text.substring(startIndex, endIndex);
    }
    return null;
}

/**
 * Try to parse JSON-style tool call: toolName{"param":"value"} or toolName({"param":"value"})
 * This handles smaller LLMs that output JSON instead of XML.
 */
export function parseJSONToolCall(
    text: string,
    knownToolNames: string[]
): ExtractedToolCall | null {
    if (!text || knownToolNames.length === 0) {
        return null;
    }

    // Pattern: toolName...{
    for (const toolName of knownToolNames) {
        const escapedName = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        // Find start of tool call
        // Matches: toolName { or toolName({ or toolName( {
        // We only care about finding the start index of the JSON object
        const startPattern = new RegExp(`${escapedName}\\s*(?:\\(?\\s*)?({)`, "i");
        const match = text.match(startPattern);

        if (match && match.index !== undefined) {
            // Calculate start index of the brace. 
            // match[0] is the full match, match[1] is the capturing group '{'
            // We need index of the '{' in the original text.
            // match.index is start of match.
            // We can search for '{' starting from match.index.
            const braceIndex = text.indexOf('{', match.index);

            if (braceIndex !== -1) {
                const jsonStr = extractBalancedJSON(text, braceIndex);

                if (jsonStr) {
                    try {
                        // Clean up JSON if mainly valid but has minor issues
                        const cleanedJson = jsonStr
                            .replace(/'/g, '"') // Convert single quotes to double
                            .replace(/(\w+):/g, '"$1":') // Add quotes around unquoted keys
                            .replace(/,\s*}/g, "}"); // Remove trailing commas

                        const args = JSON.parse(cleanedJson);
                        logger.debug(
                            `[JSON Fallback] Successfully extracted tool call "${toolName}" via JSON fallback`
                        );
                        return {
                            name: toolName,
                            arguments: args,
                        };
                    } catch {
                        // JSON parse failed
                        continue;
                    }
                }
            }
        }
    }

    return null;
}
