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

  // 1. Build Strict XML Schema for Tools
  const toolDefinitions = tools.map((tool) => {
    const { name, description, parameters } = tool.function;
    const props = parameters.properties as Record<string, ToolParameter>;
    const required = new Set(parameters.required ?? []);

    // Build parameter list
    const paramLines = Object.entries(props).map(([pName, pSchema]) => {
      const isReq = required.has(pName) ? "true" : "false";
      // Sanitized description for XML attribute
      const safeDesc = (pSchema.description ?? "No description")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const type = pSchema.type ?? "string";

      return `      <parameter name="${pName}" type="${type}" required="${isReq}">
        <description>${safeDesc}</description>
      </parameter>`;
    }).join("\n");

    return `  <tool_definition>
    <name>${name}</name>
    <description>${description ?? "No description"}</description>
    <parameters>
${paramLines}
    </parameters>
  </tool_definition>`;
  }).join("\n");

  // 2. Generate Contextual Example
  const firstTool = tools[0]?.function;
  let exampleUsage = "";

  if (firstTool) {
    const props = firstTool.parameters.properties as Record<string, ToolParameter>;
    const entries = Object.entries(props).slice(0, 3); // Max 3 params for example

    let innerXML = "";
    if (entries.length > 0) {
      innerXML = entries.map(([key, schema]) => {
        const val = schema.type === "number" ? "42" : schema.type === "boolean" ? "true" : "example_value";
        return `    <${key}>${val}</${key}>`;
      }).join("\n");
    } else {
      innerXML = `    <!-- No parameters -->`;
    }

    exampleUsage = `<toolbridge:calls>
  <${firstTool.name}>
${innerXML}
  </${firstTool.name}>
</toolbridge:calls>`;
  } else {
    // Fallback if no tools (shouldn't happen given check above)
    exampleUsage = `<toolbridge:calls><tool>...</tool></toolbridge:calls>`;
  }

  // 3. Assemble The System Prompt
  // 3. Assemble The System Prompt - Optimized for XML Strictness and Conciseness
  return `<tool_code>
You are an intelligent agent equipped with tools. You must use them to fulfill the user's request.

<strict_mode>
- Call tools using strict XML syntax wrapped in <toolbridge:calls>
- NO Markdown code blocks
- NO JSON inside XML tags (unless explicitly requested)
- NO JSON for tool calls
</strict_mode>

<available_tools>
${toolDefinitions}
</available_tools>

<instructions>
1. Analyze the request step-by-step.
2. If tool needed, wrap call in <toolbridge:calls>...</toolbridge:calls>
3. Root element = tool name. Nested elements = parameters.
4. Output RAW XML only.
</instructions>

<examples>
${exampleUsage}
</examples>
</tool_code>`;
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

  return `REMINDER: Tools available: ${toolNames}.
STRICT FORMAT REQUIRED:
<toolbridge:calls><tool_name><param>value</param></tool_name></toolbridge:calls>
NO Markdown. RAW XML only.`;
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
    if (!msg) { continue; }

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