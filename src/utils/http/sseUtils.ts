import type { OpenAIStreamChunk, ExtractedToolCall } from "../../types/index.js";

export function formatSSEChunk(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function createChatStreamChunk(
  id?: string | null,
  model?: string | null,
  contentDelta?: string | null,
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | null = null,
): OpenAIStreamChunk {
  const chunk: OpenAIStreamChunk = {
  id: id ?? `chatcmpl-proxy-stream-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
  model: model ?? "proxied-backend-model",
    choices: [
      {
        index: 0,
        delta: { role: "assistant" },
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  };

  // Ensure delta.content is always a string (OpenAIStreamChunk expects string)
  const firstChoice = chunk.choices[0];
  if (firstChoice) {
    firstChoice.delta.content = contentDelta ?? '';

    if (finishReason === null) {
      delete firstChoice.finish_reason;
    }
  }

  return chunk;
}

export function createFunctionCallStreamChunks(
  toolCall: ExtractedToolCall,
  id?: string | null, 
  model?: string | null
): OpenAIStreamChunk[] {
  const baseId = id ?? `chatcmpl-proxy-func-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const baseModel = model ?? "proxied-backend-model";

  const roleChunk: OpenAIStreamChunk = {
    id: baseId,
    object: "chat.completion.chunk",
    created: created,
    model: baseModel,
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
        },
        finish_reason: null,
      },
    ],
  };

  const toolCallId = `call_${Date.now()}`;
  const toolCallChunk: OpenAIStreamChunk = {
    id: baseId,
    object: "chat.completion.chunk",
    created: created,
    model: baseModel,
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: toolCallId,
              type: "function",
              function: {
                name: toolCall.name,
                arguments: JSON.stringify(toolCall.arguments),
              },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  };

  const finishChunk: OpenAIStreamChunk = {
    id: baseId,
    object: "chat.completion.chunk",
    created: created,
    model: baseModel,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "tool_calls",
      },
    ],
  };

  return [roleChunk, toolCallChunk, finishChunk];
}

export function createFinalToolCallChunk(
  id?: string | null, 
  model?: string | null
): OpenAIStreamChunk {
  return {
  id: id ?? `chatcmpl-proxy-toolend-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
  model: model ?? "proxied-backend-model",
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "tool_calls",
        logprobs: null,
      },
    ],
  };
}