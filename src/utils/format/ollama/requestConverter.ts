import logger from "../../logger.js";
import { formatToolsForBackendPromptXML } from "../../promptUtils.js";

import type { OpenAIRequest, OllamaRequest, OpenAIMessage } from "../../../types/index.js";

export function convertOllamaRequestToOllama(ollamaRequest: OllamaRequest): OllamaRequest {
  const updatedRequest: OllamaRequest = { ...ollamaRequest };

  if (
    !(updatedRequest.template?.includes("ToolCalls") ?? false)
  ) {
    // Ensure there is a base template and append the ToolCalls marker
    updatedRequest.template = updatedRequest.template ?? "{{system}}\n{{user}}\n{{assistant}}";
    updatedRequest.template += " ToolCalls";
    logger.debug(
      "[CONVERT] Added ToolCalls to Ollama template for tool support signaling",
    );
  }

  return updatedRequest;
}

export function convertOpenAIRequestToOllama(openAIRequest: OpenAIRequest): OllamaRequest {
  const ollamaRequest: OllamaRequest = {
    model: openAIRequest.model,
    stream: openAIRequest.stream === true,
    options: {},
    template: "{{system}}\n{{user}}\n{{assistant}} ToolCalls",
  };

  if (openAIRequest.temperature !== undefined) {
    ollamaRequest.options ??= {};
    ollamaRequest.options.temperature = openAIRequest.temperature;
  }
  if (openAIRequest.top_p !== undefined) {
    ollamaRequest.options ??= {};
    ollamaRequest.options.top_p = openAIRequest.top_p;
  }
  if (openAIRequest.max_tokens !== undefined) {
    ollamaRequest.options ??= {};
    ollamaRequest.options.num_predict = openAIRequest.max_tokens;
  }
  if (openAIRequest.stop !== undefined) {
    ollamaRequest.options ??= {};
    ollamaRequest.options.stop = Array.isArray(openAIRequest.stop)
      ? openAIRequest.stop
      : [openAIRequest.stop];
  }

  if (openAIRequest.messages.length > 0) {
    const systemMessages = openAIRequest.messages.filter(
      (msg) => msg.role === "system",
    );

    if (systemMessages.length > 0) {
      ollamaRequest.system = systemMessages
        .map((msg) => msg.content)
        .join("\n\n");
    }

    const userMessages = openAIRequest.messages.filter(
      (msg) => msg.role === "user",
    );
    if (userMessages.length > 0) {
      ollamaRequest.prompt = userMessages[userMessages.length - 1].content ?? '';
    } else {
      logger.debug(
        "[CONVERT] OpenAI request has messages but no user message. Using last message content for prompt.",
      );
      const lastMessage =
        openAIRequest.messages[openAIRequest.messages.length - 1];
  ollamaRequest.prompt = lastMessage.content ?? "";
    }
  }

  if (openAIRequest.tools && openAIRequest.tools.length > 0) {
    logger.debug(
      "[CONVERT] Converting OpenAI tools for Ollama request (using system prompt injection)",
    );
    const toolInstructions = formatToolsForBackendPromptXML(
      openAIRequest.tools,
    );
    ollamaRequest.system =
      (ollamaRequest.system ? ollamaRequest.system + "\n\n" : "") +
      toolInstructions;

    logger.debug(
      "[CONVERT] Injected tool instructions into Ollama system prompt.",
    );
  }

  if (openAIRequest.tool_choice) {
    logger.debug(
      "[CONVERT] OpenAI 'tool_choice' is not directly supported for Ollama conversion. Ignoring.",
    );
  }

  if (ollamaRequest.options && Object.keys(ollamaRequest.options).length === 0) {
    delete ollamaRequest.options;
  }

  return ollamaRequest;
}

export function convertOllamaRequestToOpenAI(ollamaRequest: OllamaRequest): OpenAIRequest {
  const openAIRequest: OpenAIRequest = {
    model: ollamaRequest.model,
    stream: ollamaRequest.stream === true,
    messages: [],
  };

  if (ollamaRequest.options) {
    if (ollamaRequest.options.temperature !== undefined) {
      openAIRequest.temperature = ollamaRequest.options.temperature;
    }
    if (ollamaRequest.options.top_p !== undefined) {
      openAIRequest.top_p = ollamaRequest.options.top_p;
    }
    if (ollamaRequest.options.num_predict !== undefined) {
      openAIRequest.max_tokens = ollamaRequest.options.num_predict;
    }
    if (ollamaRequest.options.stop !== undefined) {
      openAIRequest.stop = ollamaRequest.options.stop;
    }
  }

  if (ollamaRequest.system) {
    const systemMessage: OpenAIMessage = {
      role: "system",
      content: ollamaRequest.system,
    };
    openAIRequest.messages.push(systemMessage);
  }
  if (ollamaRequest.prompt) {
    const userMessage: OpenAIMessage = {
      role: "user",
      content: ollamaRequest.prompt,
    };
    openAIRequest.messages.push(userMessage);
  }

  if (ollamaRequest.tools) {
    openAIRequest.tools = ollamaRequest.tools;

    logger.debug("[CONVERT] Passing through Ollama tools to OpenAI request.");
  }
  if (ollamaRequest.tool_choice) {
    openAIRequest.tool_choice = ollamaRequest.tool_choice as "none" | "auto" | { type: "function"; function: { name: string; }; };
    logger.debug(
      "[CONVERT] Passing through Ollama tool_choice to OpenAI request.",
    );
  }

  if (openAIRequest.messages.length === 0) {
    logger.error(
      "[CONVERT] Ollama request could not be converted to OpenAI: Missing prompt or messages.",
    );

    throw new Error(
      "Cannot convert Ollama request to OpenAI: No messages could be constructed.",
    );
  }

  return openAIRequest;
}