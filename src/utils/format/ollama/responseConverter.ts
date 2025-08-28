import logger from "../../logger.js";
import { extractToolCallXMLParser } from "../../xmlUtils.js";

import type { 
  OpenAIResponse, 
  OpenAIStreamChunk, 
  OllamaResponse, 
  OllamaStreamChunk 
} from "../../../types/index.js";

export function convertOllamaResponseToOllama(ollamaResponse: OllamaResponse): OllamaResponse {
  const updatedResponse: OllamaResponse = { ...ollamaResponse };

  if (
    updatedResponse.template &&
    !updatedResponse.template.includes("ToolCalls")
  ) {
    updatedResponse.template = updatedResponse.template + " ToolCalls";
    logger.debug(
      "[CONVERT] Added ToolCalls to Ollama response template for tool support signaling",
    );
  } else if (
    !updatedResponse.template &&
    (updatedResponse.tool_calls ||
      (updatedResponse.response && updatedResponse.response.includes("<") &&
        updatedResponse.response.includes(">")))
  ) {
    updatedResponse.template = "{{system}}\n{{user}}\n{{assistant}} ToolCalls";
    logger.debug(
      "[CONVERT] Created template with ToolCalls for Ollama response with tool capabilities",
    );
  }

  return updatedResponse;
}

export function convertOpenAIResponseToOllama(
  openAIResponse: OpenAIResponse | OpenAIStreamChunk,
  knownToolNames: string[] = [],
): OllamaResponse | OllamaStreamChunk {
  const baseOllamaResponse = {
    model: openAIResponse.model,
    created_at: new Date(
      openAIResponse.created * 1000,
    ).toISOString(),
    done: false,
  };

  const choice = openAIResponse.choices[0];
  const toNum = (v: unknown) => (typeof v === "number" ? v : 0);

  if (
    openAIResponse.object === "chat.completion.chunk" &&
    choice !== null && choice !== undefined &&
    'delta' in choice
  ) {
    const delta = choice.delta;
    const ollamaChunk: OllamaStreamChunk = {
      ...baseOllamaResponse,
  response: delta.content ?? "",
      done: choice.finish_reason !== null,
    };

    if (ollamaChunk.done && openAIResponse.usage) {
      const usage = openAIResponse.usage as Record<string, unknown>;
      ollamaChunk.total_duration = toNum(usage.total_duration);
      ollamaChunk.load_duration = toNum(usage.load_duration);
      ollamaChunk.prompt_eval_count = toNum(usage.prompt_tokens);
      ollamaChunk.prompt_eval_duration = toNum(usage.prompt_eval_duration);
      ollamaChunk.eval_count = toNum(usage.completion_tokens);
      ollamaChunk.eval_duration = toNum(usage.eval_duration);
    }

    const deltaContent = delta.content ?? "";

    if (delta.tool_calls && delta.tool_calls.length > 0) {
      ollamaChunk.tool_calls = delta.tool_calls.map((tc) => ({
        function: {
          name: tc.function?.name ?? "",
          arguments: tc.function?.arguments ?? {},
        },
      }));

      ollamaChunk.response = "";
    } else if (deltaContent.includes("<") && deltaContent.includes(">")) {
      const toolCall = extractToolCallXMLParser(deltaContent, knownToolNames);
      if (toolCall) {
        logger.debug(
          "[CONVERT] Extracted XML tool call from OpenAI response content:",
          toolCall,
        );
        ollamaChunk.tool_calls = [
          {
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          },
        ];

        ollamaChunk.response = "";
      }
    }

    return ollamaChunk;
  }

  if (openAIResponse.object === "chat.completion" && choice !== null && choice !== undefined && 'message' in choice) {
    const message = choice.message;
    const ollamaResponse: OllamaResponse = {
      ...baseOllamaResponse,
  response: message.content ?? "",
      done: true,
    };

    if (openAIResponse.usage !== null && openAIResponse.usage !== undefined) {
      const usage = openAIResponse.usage as unknown as Record<string, unknown>;
      ollamaResponse.total_duration = toNum(usage.total_duration);
      ollamaResponse.load_duration = toNum(usage.load_duration);
      ollamaResponse.prompt_eval_count = toNum(usage.prompt_tokens);
      ollamaResponse.prompt_eval_duration = toNum(usage.prompt_eval_duration);
      ollamaResponse.eval_count = toNum(usage.completion_tokens);
      ollamaResponse.eval_duration = toNum(usage.eval_duration);
    }

      if (message.tool_calls && message.tool_calls.length > 0) {
      ollamaResponse.tool_calls = message.tool_calls.map((tc) => ({
        function: {
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        },
      }));

      if (!message.content) {
        ollamaResponse.response = "";
      }
    } else {
      const messageContent = message.content ?? "";
      if (messageContent.includes("<") && messageContent.includes(">")) {
        const toolCall = extractToolCallXMLParser(messageContent, knownToolNames);
      if (toolCall) {
        logger.debug(
          "[CONVERT] Extracted XML tool call from OpenAI response content:",
          toolCall,
        );
        ollamaResponse.tool_calls = [
          {
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          },
        ];

        ollamaResponse.response = "";
      }
    }
  }

    return ollamaResponse;
  }

  logger.debug(
    "[CONVERT] Unknown OpenAI response format encountered:",
    openAIResponse,
  );
  return { ...baseOllamaResponse, response: "[Conversion Error]", done: true };
}

export function convertOllamaResponseToOpenAI(
  ollamaResponse: OllamaResponse | OllamaStreamChunk,
  stream: boolean = false,
  knownToolNames: string[] = [],
): OpenAIResponse | OpenAIStreamChunk {
  const now = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-ollama-${Date.now()}`;

  const toNum = (v: unknown) => (typeof v === "number" ? v : 0);

  if (stream) {
    const openAIChunk: OpenAIStreamChunk = {
      id: id,
      object: "chat.completion.chunk",
      created: now,
      model: ollamaResponse.model,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: ollamaResponse.response ?? '',
          },
          finish_reason: ollamaResponse.done ? "stop" : null,
          logprobs: null,
        },
      ],
    };

    if (ollamaResponse.done) {
      openAIChunk.choices[0].finish_reason = "stop";

      if (ollamaResponse.tool_calls) {
        openAIChunk.choices[0].finish_reason = "tool_calls";
      }

      if (
        ('eval_count' in ollamaResponse && (ollamaResponse as unknown as Record<string, unknown>).eval_count !== undefined) ||
        ('prompt_eval_count' in ollamaResponse && (ollamaResponse as unknown as Record<string, unknown>).prompt_eval_count !== undefined)
      ) {
        const r = ollamaResponse as unknown as Record<string, unknown>;
        const prompt = toNum(r.prompt_eval_count);
        const evalc = toNum(r.eval_count);
        openAIChunk.usage = {
          prompt_tokens: prompt,
          completion_tokens: evalc,
          total_tokens: prompt + evalc,
        };
      }
    } else {
      openAIChunk.choices[0].finish_reason = null;
    }

  if (ollamaResponse.tool_calls && !ollamaResponse.done) {
      openAIChunk.choices[0].delta = {
        tool_calls: ollamaResponse.tool_calls.map((tc, index) => ({
          index: index,
          id: `call_ollama_${Date.now()}_${index}`,
          type: "function",
    function: {
    name: tc.function?.name ?? "",
    arguments: JSON.stringify(tc.function?.arguments ?? {}),
      },
        })),
      };

      openAIChunk.choices[0].delta.content = '';
      openAIChunk.choices[0].finish_reason = null;
    } else if (!ollamaResponse.response && !ollamaResponse.done) {
      openAIChunk.choices[0].delta.content = "";
    } else if (
      !ollamaResponse.response &&
      ollamaResponse.done &&
      !openAIChunk.choices[0].finish_reason
    ) {
      openAIChunk.choices[0].finish_reason = "stop";
    }

    openAIChunk.choices[0].delta.content ??= '';

    return openAIChunk;
  }

    const openAIResponse: OpenAIResponse = {
    id: id,
    object: "chat.completion",
    created: ('created_at' in ollamaResponse && ollamaResponse.created_at)
      ? Math.floor(new Date(ollamaResponse.created_at).getTime() / 1000)
      : now,
  model: ollamaResponse.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: ollamaResponse.response ?? null,
        },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: toNum((ollamaResponse as unknown as Record<string, unknown>).prompt_eval_count),
      completion_tokens: toNum((ollamaResponse as unknown as Record<string, unknown>).eval_count),
      total_tokens:
        toNum((ollamaResponse as unknown as Record<string, unknown>).prompt_eval_count) +
        toNum((ollamaResponse as unknown as Record<string, unknown>).eval_count),
    },
  };

  if (ollamaResponse.response) {
    const toolCall = extractToolCallXMLParser(
      ollamaResponse.response,
      knownToolNames,
    );
    if (toolCall) {
      logger.debug(
        "[CONVERT] Detected XML tool call in Ollama response:",
        toolCall,
      );
      openAIResponse.choices[0].message.content = null;
      openAIResponse.choices[0].message.tool_calls = [
        {
          id: `call_ollama_${Date.now()}`,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
        },
      ];
      openAIResponse.choices[0].finish_reason = "tool_calls";
    }
  } else if (ollamaResponse.tool_calls) {
    logger.debug(
      "[CONVERT] Detected structured tool calls in Ollama response:",
      ollamaResponse.tool_calls,
    );
  openAIResponse.choices[0].message.content = ollamaResponse.response ?? null;
    openAIResponse.choices[0].message.tool_calls =
      ollamaResponse.tool_calls.map((tc, index) => ({
        id: `call_ollama_${Date.now()}_${index}`,
        type: "function",
        function: {
          name: tc.function.name,
          arguments: JSON.stringify(tc.function.arguments ?? {}),
        },
      }));
    openAIResponse.choices[0].finish_reason = "tool_calls";

    if (openAIResponse.choices[0].message.content === null || openAIResponse.choices[0].message.content === undefined) {
      openAIResponse.choices[0].message.content = null;
    }
  }

  if (
    openAIResponse.choices[0].message.content === undefined &&
    openAIResponse.choices[0].message.tool_calls === null || openAIResponse.choices[0].message.tool_calls === undefined
  ) {
    openAIResponse.choices[0].message.content = null;
  }

  return openAIResponse;
}