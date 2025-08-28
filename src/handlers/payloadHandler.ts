
import {
  ENABLE_TOOL_REINJECTION,
  TOOL_REINJECTION_MESSAGE_COUNT,
  TOOL_REINJECTION_TOKEN_COUNT,
} from "../config.js";
import logger from "../utils/logger.js";
import {
  createToolReminderMessage,
  formatToolsForBackendPromptXML,
  needsToolReinjection,
} from "../utils/promptUtils.js";

import type { 
  OpenAITool, 
  OpenAIMessage, 
  BackendPayload
} from "../types/index.js";

interface BuildBackendPayloadInput {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  tool_choice?: unknown;
  functions?: unknown;
  function_call?: unknown;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

function injectToolInstructions(payload: BackendPayload, tools: OpenAITool[]): void {
  const toolInstructions = formatToolsForBackendPromptXML(tools);

  const exclusiveToolsNotice = `\nIMPORTANT: The tools listed above are the ONLY tools available to you. Do not attempt to use any other tools.`;

  const fullInstructions = `${toolInstructions}${exclusiveToolsNotice}`;

  payload.messages ??= [];

  const systemMessageIndex = payload.messages.findIndex(
    (m) => m.role === "system",
  );

  if (systemMessageIndex !== -1) {
    if (
      ENABLE_TOOL_REINJECTION &&
      needsToolReinjection(
        payload.messages.map(msg => ({ role: msg.role, content: msg.content })) as OpenAIMessage[],
        TOOL_REINJECTION_TOKEN_COUNT,
        TOOL_REINJECTION_MESSAGE_COUNT,
      )
    ) {
      logger.debug(
        "Tool reinjection enabled and needed based on message/token thresholds.",
      );

      const instructionsToInject = createToolReminderMessage(tools);

      const reinjectionIndex = systemMessageIndex + 1;

      payload.messages.splice(reinjectionIndex, 0, {
        role: "system",
        content: instructionsToInject,
      });

      logger.debug("Reinjected tool instructions as a new system message.");
    } else {
      const currentContent = payload.messages[systemMessageIndex].content;
      payload.messages[systemMessageIndex].content = `${currentContent}\n\n${fullInstructions}`;
      logger.debug(
        "Appended XML tool instructions to existing system message.",
      );
    }
  } else {
    payload.messages.unshift({
      role: "system",
      content: `${fullInstructions}\n\nYou are a helpful AI assistant. Respond directly to the user's requests. When a specific tool is needed, use XML format as instructed above.`,
    });
    logger.debug("Added system message with XML tool instructions.");
  }

  payload.messages.push({
    role: "system",
    content:
      "IMPORTANT: When using tools, output raw XML only - no code blocks, no backticks, no explanations.",
  });
}

export function buildBackendPayload({
  model,
  messages,
  tools,
  _tool_choice,
  _functions,
  _function_call,
  temperature,
  top_p,
  max_tokens,
  ...rest
}: BuildBackendPayloadInput): BackendPayload {
  // Build clean payload - explicitly exclude ALL tool fields
  const payload: BackendPayload = {
    model,
    messages: [...messages].map(msg => ({
      role: msg.role,
      content: msg.content ?? "",
    })),
    ...(temperature !== undefined && { temperature }),
    ...(top_p !== undefined && { top_p }),
    ...(max_tokens !== undefined && { max_tokens }),
    ...rest,
  };

  // Remove ALL possible tool-related fields to ensure clean payload
  delete payload.tools;
  delete payload.tool_choice;
  delete payload.functions;
  delete payload.function_call;

  // Add XML tool instructions to system messages (ToolBridge's method)
  if (tools && tools.length > 0) {
    injectToolInstructions(payload, tools);
  }

  return payload; // Guaranteed clean of all native tool fields
}