
import { logger } from "../logging/index.js";
import { configService } from "../services/index.js";
import {
  createToolReminderMessage,
  formatToolsForBackendPromptXML,
  needsToolReinjection,
} from "../translation/tools/promptUtils.js";

import type { 
  OpenAITool, 
  OpenAIMessage, 
  BackendPayload,
  OpenAIMessageContent,
} from "../types/index.js";

/**
 * Convert OpenAI message content (which can be string or array) to a plain string.
 * For array format (multimodal), extract text content and discard image data.
 */
function extractStringContent(content: OpenAIMessageContent): string {
  if (content === null) {return "";}
  if (typeof content === "string") {return content;}

  // Array format: extract text parts
  const textParts: string[] = [];
  for (const part of content) {
    if (part.type === "text" && part.text) {
      textParts.push(part.text);
    }
  }
  return textParts.join("\n");
}

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
    const systemMessage = payload.messages[systemMessageIndex];
    if (systemMessage) {
      const currentContent = String(systemMessage.content);

      // Avoid duplicating the heavy instruction block if it's already present
      const hasInstructionsAlready =
        currentContent.includes("# TOOL USAGE INSTRUCTIONS") ||
        currentContent.includes("<toolbridge:calls>");

      const reinjectionConfig = configService.getToolReinjectionConfig();

    if (
      reinjectionConfig.enabled &&
      needsToolReinjection(
        payload.messages.map(msg => ({ role: msg.role, content: msg.content })) as OpenAIMessage[],
        reinjectionConfig.tokenCount,
        reinjectionConfig.messageCount,
      )
    ) {
      logger.debug(
        "Tool reinjection enabled and needed based on message/token thresholds.",
      );

      const instructionsToInject = createToolReminderMessage(tools);

      // Avoid redundant reinjections: if any of the last N messages already contain key hints, skip.
      const recentWindow = Math.max(payload.messages.length - 6, 0);
      const alreadyReminded = payload.messages.slice(recentWindow).some((m) => {
        const c = String(m.content);
        return c.includes("# TOOL USAGE INSTRUCTIONS") ||
               c.includes("<toolbridge:calls>") ||
               c.includes("Output raw XML only") ||
               c.includes("ONLY output raw XML");
      });

      if (!alreadyReminded) {
        // Honor reinjection role from config. If multiple system messages exist, prefer user role to avoid overriding base system.
        const systemCount = payload.messages.filter((m) => m.role === "system").length;
        const reinjectionRole: "system" | "user" = (reinjectionConfig.type === "system" && systemCount <= 1)
          ? "system"
          : "user";

        const reinjectionIndex = reinjectionRole === "system" ? systemMessageIndex + 1 : payload.messages.length;

        payload.messages.splice(reinjectionIndex, 0, {
          role: reinjectionRole,
          content: instructionsToInject,
        });

        logger.debug(`Reinjected tool instructions as a new ${reinjectionRole} message.`);
      } else {
        logger.debug("Skipping reinjection: recent messages already contain tool reminder signals.");
      }
    } else if (!hasInstructionsAlready) {
      systemMessage.content = `${currentContent}\n\n${fullInstructions}`;
      logger.debug("Appended XML tool instructions to existing system message.");
    } else {
      logger.debug("Skipping tool instruction append; already present in system message.");
    }
    }
  } else {
    payload.messages.unshift({
      role: "system",
      content: `${fullInstructions}\n\nYou are a helpful AI assistant. Respond directly to the user's requests. When a specific tool is needed, use XML format as instructed above.`,
    });
    logger.debug("Added system message with XML tool instructions.");
  }

  // Do not add any additional trailing system messages here to keep the prompt lean.
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
      content: extractStringContent(msg.content),
    })),
    ...(temperature !== undefined && { temperature }),
    ...(top_p !== undefined && { top_p }),
    ...(max_tokens !== undefined && { max_tokens }),
    ...rest,
  };

  // Handle tool fields based on PASS_TOOLS configuration
  if (configService.shouldPassTools()) {
    // Keep original tool fields - backend provider will receive them
    // Tool instructions are still added to system messages for compatibility
    logger.debug("PASS_TOOLS=true: Keeping original tool fields in payload");
    if (tools && tools.length > 0) {
      payload.tools = tools;
      if (_tool_choice !== undefined) {
        payload.tool_choice = _tool_choice;
      }
    }
  } else {
    // Remove ALL possible tool-related fields to ensure clean payload (original behavior)
    logger.debug("PASS_TOOLS=false: Removing all tool fields from payload");
    delete payload.tools;
    delete payload.tool_choice;
    delete payload.functions;
    delete payload.function_call;
  }

  // Always add XML tool instructions to system messages (ToolBridge's method)
  // This works regardless of PASS_TOOLS setting for maximum compatibility
  if (tools && tools.length > 0) {
    injectToolInstructions(payload, tools);
  }

  return payload; // Guaranteed clean of all native tool fields
}