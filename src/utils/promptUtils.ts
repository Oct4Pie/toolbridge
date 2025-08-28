import type { OpenAITool, OpenAIMessage } from "../types/index.js";

interface ToolParameter {
  type?: string;
  description?: string;
  [key: string]: unknown;
}

interface ExampleTool {
  name: string;
  desc: string;
  example: string;
}

function formatToolsForBackendPromptXML(tools: OpenAITool[] = []): string {
  if (tools.length === 0) { return ""; }

  const toolDescriptions = tools
    .map((toolSpec) => {
      const func = toolSpec.function;

      const { name, description, parameters } = func;
      let result = `Tool Name: ${name}\nDescription: ${
        description ?? "No description provided"
      }\nParameters:`;

      const props = parameters.properties as Record<string, ToolParameter>;
      const required = parameters.required ?? [];

      if (Object.keys(props).length > 0) {
        Object.keys(props).forEach((paramName) => {
          const param = props[paramName];
          const paramDesc = param.description ?? "No description";
          const isRequired = Array.isArray(required) && required.includes(paramName);

          result += `\n* ${paramName} (${param.type ?? "any"}): ${paramDesc}${
            isRequired ? " (required)" : ""
          }`;
        });
      } else {
        result += "\n* No parameters defined";
      }

      return result;
    })
    .join("\n\n");

  const exampleTools: ExampleTool[] = [];

  const functionTools = tools; // All tools are function tools in OpenAI format

  const noParamTool = functionTools.find((t) => {
    const props = t.function.parameters.properties;
    return Object.keys(props).length === 0;
  });

  const singleParamTool = functionTools.find((t) => {
    const props = t.function.parameters.properties;
    return Object.keys(props).length === 1;
  });

  const multiParamTool = functionTools.find((t) => {
    const props = t.function.parameters.properties;
    return Object.keys(props).length > 1;
  });

  if (noParamTool) {
    exampleTools.push({
      name: noParamTool.function.name,
      desc: "Tool with no parameters",
      example: `<toolbridge:calls>\n  <${noParamTool.function.name}></${noParamTool.function.name}>\n</toolbridge:calls>`,
    });
  }

  if (singleParamTool) {
    const paramName = Object.keys(
      singleParamTool.function.parameters.properties,
    )[0];
    const paramProps = singleParamTool.function.parameters.properties as Record<string, ToolParameter>;
    const paramType = paramProps[paramName].type ?? "string";
    let paramValue = "example value";

    if (paramType === "number") { paramValue = "42"; }
    else if (paramType === "boolean") { paramValue = "true"; }
    else if (paramName.includes("query")) { paramValue = "What is the capital of France?"; }
    else if (paramName.includes("url")) { paramValue = "https://example.com"; }

    exampleTools.push({
      name: singleParamTool.function.name,
      desc: `Tool with a single ${paramType} parameter: '${paramName}'`,
      example: `<toolbridge:calls>\n  <${singleParamTool.function.name}>\n    <${paramName}>${paramValue}</${paramName}>\n  </${singleParamTool.function.name}>\n</toolbridge:calls>`,
    });
  }

  if (multiParamTool) {
    const params = Object.entries(
      multiParamTool.function.parameters.properties as Record<string, ToolParameter>,
    );
    const paramLines = params
      .map(([name, schema]) => {
        const type = schema.type ?? "string";
        let value = "example";

        if (type === "number") { value = "42"; }
        else if (type === "boolean") { value = "true"; }
        else if (name.includes("date")) { value = "2025-05-15"; }
        else if (name.includes("email")) { value = "user@example.com"; }
        else if (name.includes("url")) { value = "https://example.com"; }
        else if (name.includes("name")) { value = "Example Name"; }

        return `  <${name}>${value}</${name}>`;
      })
      .join("\n");

    exampleTools.push({
      name: multiParamTool.function.name,
      desc: `Tool with ${params.length} parameters of various types`,
      example: `<toolbridge:calls>\n  <${multiParamTool.function.name}>\n${paramLines.split('\n').map(line => '  ' + line).join('\n')}\n  </${multiParamTool.function.name}>\n</toolbridge:calls>`,
    });
  }

  if (exampleTools.length < 2) {
    if (!exampleTools.some((t) => t.desc.includes("no parameters"))) {
      exampleTools.push({
        name: "getCurrentWeather",
        desc: "Generic example: Tool with no parameters",
        example: "<toolbridge:calls>\n  <getCurrentWeather></getCurrentWeather>\n</toolbridge:calls>",
      });
    }

    if (!exampleTools.some((t) => t.desc.includes("single"))) {
      exampleTools.push({
        name: "searchWeb",
        desc: "Generic example: Tool with a single string parameter",
        example:
          "<toolbridge:calls>\n  <searchWeb>\n    <query>What is the capital of France?</query>\n  </searchWeb>\n</toolbridge:calls>",
      });
    }

    if (!exampleTools.some((t) => t.desc.includes("various types"))) {
      exampleTools.push({
        name: "bookFlight",
        desc: "Generic example: Tool with multiple parameters of different types",
        example:
          "<toolbridge:calls>\n  <bookFlight>\n    <destination>Tokyo</destination>\n    <departureDate>2025-05-15</departureDate>\n    <returnDate>2025-05-30</returnDate>\n    <passengers>2</passengers>\n    <businessClass>true</businessClass>\n  </bookFlight>\n</toolbridge:calls>",
      });
    }
  }

  exampleTools.push({
    name: "createUserProfile",
    desc: "Advanced example: Tool with nested object parameters",
    example:
      "<toolbridge:calls>\n  <createUserProfile>\n    <userData>\n      <n>John Doe</n>\n      <email>john.doe@example.com</email>\n      <preferences>\n        <theme>dark</theme>\n        <notifications>true</notifications>\n      </preferences>\n    </userData>\n  </createUserProfile>\n</toolbridge:calls>",
  });

  exampleTools.push({
    name: "insert_edit_into_file",
    desc: "Tool with raw HTML content in parameters (never escape HTML and other such tags)",
    example:
      '<toolbridge:calls>\n  <insert_edit_into_file>\n    <explanation>Update HTML content</explanation>\n    <filePath>/path/to/file.html</filePath>\n    <code><div class="container">\n    <h1>Raw HTML tags</h1>\n    <p>This content has <b>unescaped</b> HTML tags</p>\n  </div></code>\n  </insert_edit_into_file>\n</toolbridge:calls>',
  });

  const examplesText = exampleTools
    .map((tool, index) => `Example ${index + 1}: ${tool.desc}\n${tool.example}`)
    .join("\n\n");

  return `# TOOL USAGE INSTRUCTIONS

## Available Tools
You have access to the following tools:

${toolDescriptions}

## Response Format
When using a tool, you MUST wrap your tool calls in <toolbridge:calls> tags.
ONLY content within these wrapper tags will be parsed as tool calls.
Output the raw XML for the tool call without any additional text, code blocks, or explanations.

## Examples of Correct Tool Usage
${examplesText}

## Critical Rules
1. ALWAYS wrap tool calls in <toolbridge:calls>...</toolbridge:calls> tags
2. ONLY output raw XML when calling a tool - no explanations, backticks, or code blocks
3. Never mention XML format or tools to users - they are internal only
4. Always use the EXACT tool name as specified above - do NOT create new tool names
5. For HTML content in parameters: ALWAYS use raw tags (<div>, <p>, etc.) - NEVER use HTML entities (&lt;div&gt;)

## XML Formatting Requirements
- ALL tool calls MUST be wrapped in <toolbridge:calls>...</toolbridge:calls> tags
- Content outside these wrapper tags will NOT be parsed as tool calls
- Root element (inside wrapper) MUST be the EXACT tool name as listed above
- Each parameter must be a child element
- For arrays: repeat the element name for each value (e.g., '<tags>tag1</tags><tags>tag2</tags>')
- For empty values: use '<param></param>' or self-closing '<param/>'
- For boolean values: use '<param>true</param>' or '<param>false</param>'
- For HTML/code content: include raw HTML tags directly (<div>, <span>, etc.) - never use HTML entities
- For object parameters: use proper nesting of elements
- Ensure every opening tag has a matching closing tag

## When to Use Tools
- When the user's request requires specific capabilities provided by a tool
- When the context or workflow explicitly calls for tool usage
- When you need to perform actions outside your standard capabilities

## Handling Errors
- If a tool call fails, carefully review the error message
- Correct any formatting issues or invalid parameters
- Retry with proper parameters as indicated by the error

Remember that tools are invisible to the user - focus on addressing their needs, not explaining the tools.`;
}

function createToolReminderMessage(tools: OpenAITool[] = []): string {
  if (tools.length === 0) { return ""; }

  const toolNames = tools
    .map((t) => t.function.name) // All tools are function tools
    .join(", ");

  return `REMINDER: You have access to these tools: ${toolNames}. 
  
Use ONLY these EXACT tool names with XML format.
Output raw XML only when calling tools - no code blocks or backticks.
For HTML content: ALWAYS use raw tags (<div>) - NEVER use HTML entities (&lt;div&gt;).`;
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
  needsToolReinjection,
};