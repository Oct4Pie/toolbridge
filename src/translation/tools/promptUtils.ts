import { isRecord } from "../utils/typeGuards.js";

import type { OpenAIFunction, OpenAITool, OpenAIMessage } from "../../types/index.js";
import type { GenericTool } from "../types/index.js";

interface ToolParameter {
  type?: string;
  description?: string;
  [key: string]: unknown;
}

// removed bulky example struct in favor of compact guidance

function normalizeGenericTools(tools: GenericTool[] = []): OpenAITool[] {
  if (!Array.isArray(tools) || tools.length === 0) { return []; }

  return tools
    .filter((tool): tool is GenericTool => Boolean(tool && tool.type === 'function' && tool.function?.name))
    .map((tool) => {
      const rawParams = tool.function.parameters;
      let parameters: OpenAIFunction['parameters'] = {
        type: 'object',
        properties: {},
      };

      if (isRecord(rawParams)) {
        const properties = (rawParams as Record<string, unknown>)['properties'];
        const required = (rawParams as Record<string, unknown>)['required'];

        parameters = {
          type: 'object',
          properties: isRecord(properties) ? (properties as Record<string, unknown>) : {},
        };

        if (Array.isArray(required)) {
          parameters = {
            ...parameters,
            required: [...required.map((item) => String(item))],
          };
        }
      }

      const openaiFunction: OpenAIFunction = {
        name: tool.function.name,
        parameters,
      };

      if (typeof tool.function.description === 'string' && tool.function.description.trim().length > 0) {
        openaiFunction.description = tool.function.description;
      }

      return {
        type: 'function',
        function: openaiFunction,
      } satisfies OpenAITool;
    });
}

function formatToolsForBackendPromptXML(tools: OpenAITool[] = []): string {
  if (tools.length === 0) { return ""; }

  // Compact tool list with concise parameter summary
  const toolDescriptions = tools
    .map((toolSpec) => {
      const { name, description, parameters } = toolSpec.function;
      const props = parameters.properties as Record<string, ToolParameter>;
      const required = new Set(parameters.required ?? []);
      const paramsSummary = Object.keys(props).length === 0
        ? "(no parameters)"
        : Object.entries(props)
            .map(([p, schema]) => `${p}${required.has(p) ? "*" : ""}:${schema.type ?? "any"}`)
            .join(", ");
      return `- ${name}: ${description ?? "No description"} | params ${paramsSummary}`;
    })
    .join("\n");

  // Single minimal example using the first tool
  const firstToolFunc = tools.length > 0 ? tools[0]?.function : undefined;
  let example = "";
  if (firstToolFunc) {
    const propEntries = Object.entries(firstToolFunc.parameters.properties as Record<string, ToolParameter>);
    if (propEntries.length === 0) {
      example = `<toolbridge:calls>\n  <${firstToolFunc.name}></${firstToolFunc.name}>\n</toolbridge:calls>`;
    } else if (propEntries.length === 1) {
      const firstEntry = propEntries[0];
      if (firstEntry) {
        const [p, schema] = firstEntry;
        const sample = schema.type === "number" ? "42" : schema.type === "boolean" ? "true" : "example";
        example = `<toolbridge:calls>\n  <${firstToolFunc.name}>\n    <${p}>${sample}</${p}>\n  </${firstToolFunc.name}>\n</toolbridge:calls>`;
      }
    } else {
      const inner = propEntries
        .slice(0, Math.min(3, propEntries.length))
        .map(([p, schema]) => `    <${p}>${schema.type === "number" ? "42" : schema.type === "boolean" ? "true" : "example"}</${p}>`)
        .join("\n");
      example = `<toolbridge:calls>\n  <${firstToolFunc.name}>\n${inner}\n  </${firstToolFunc.name}>\n</toolbridge:calls>`;
    }
  }

  return `# TOOL USAGE INSTRUCTIONS

## Available Tools
${toolDescriptions}

## How to Call Tools
- Wrap tool calls in <toolbridge:calls>...</toolbridge:calls>
- Output raw XML only when calling tools (no prose, no code fences)
- Use the EXACT tool name from the list above
- For HTML/code params, include raw tags (never escape)

## Minimal Example
${example}

## XML Rules
- Root element = tool name; each parameter is a child element
- Arrays: repeat the element name; Empty: <param></param> or <param/>
- Booleans: <param>true</param> or <param>false</param>
- Objects: nested elements with matching close tags
`;
}

function buildXMLToolInstructionsFromGeneric(tools: GenericTool[] = []): string {
  const normalized = normalizeGenericTools(tools);
  return formatToolsForBackendPromptXML(normalized);
}

function createToolReminderMessage(tools: OpenAITool[] = []): string {
  if (tools.length === 0) { return ""; }

  const toolNames = tools
    .map((t) => t.function.name) // All tools are function tools
    .join(", ");

  return `REMINDER: Tools available — ${toolNames}.
Use EXACT tool names with XML in <toolbridge:calls>...</toolbridge:calls>.
Output raw XML only (no text, no backticks). For HTML/code params: use raw tags, never entities.`;
}

function estimateTokenCount(message: OpenAIMessage): number {
  const content = message.content ?? "";
  if (content.length === 0) { return 0; }
  return Math.ceil(content.length / 4);
}

function needsToolReinjection(
  messages: OpenAIMessage[] = [],
  tokenCount = 0,
  messageCount = 0,
): boolean {
  if (messages.length === 0) { return false; }

  let msgCount = 0;
  let tokCount = 0;
  let foundSystemMsg = false;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) {continue;}

    if (msg.role === "system") {
      foundSystemMsg = true;
      break;
    }

    msgCount++;
    tokCount += estimateTokenCount(msg);
  }

  return !foundSystemMsg || msgCount >= messageCount || tokCount >= tokenCount;
}

export {
  createToolReminderMessage,
  estimateTokenCount,
  formatToolsForBackendPromptXML,
  buildXMLToolInstructionsFromGeneric,
  normalizeGenericTools,
  needsToolReinjection,
};