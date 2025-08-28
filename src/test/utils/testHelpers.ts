import { PassThrough } from "stream";

import type { 
  OpenAIRequest, 
  OpenAIResponse, 
  OpenAIStreamChunk,
  OllamaRequest,
  OllamaResponse,
  OllamaStreamChunk
} from "../../types/index.js";

interface MockRequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  params?: Record<string, string>;
  url?: string;
  method?: string;
}

interface MockRequest {
  body: unknown;
  headers: Record<string, string>;
  query: Record<string, string>;
  params: Record<string, string>;
  url: string;
  method: string;
}

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  jsonCalled?: boolean;
  statusCalled?: boolean;
  writeCalled?: boolean;
  endCalled?: boolean;
  json(data: unknown): MockResponse;
  status(code: number): MockResponse;
  setHeader(name: string, value: string): MockResponse;
  getHeader(name: string): string | undefined;
  write(data: string): MockResponse;
  end(data?: string): MockResponse;
  _json(data: unknown): MockResponse;
  _status(code: number): MockResponse;
  _write(data: string): MockResponse;
  _end(data?: string): MockResponse;
}

interface MockFetchResponse {
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  headers: Map<string, string>;
}

export function createMockRequest({
  body = {},
  headers = {},
  query = {},
  params = {},
  url = "/v1/chat/completions",
  method = "POST",
}: MockRequestOptions = {}): MockRequest {
  return {
    body,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    query,
    params,
    url,
    method,
  };
}

export function createMockResponse(): MockResponse {
  const res: unknown = {
    statusCode: 200,
    headers: {},
    body: null,
    json: function (data: unknown) {
      this.body = data;
      return this;
    },
    status: function (code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader: function (name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    getHeader: function (name: string) {
      return this.headers[name];
    },
    write: function (data: string) {
      if (this.body === null || this.body === undefined) {
        this.body = "";
      }
      this.body += data;
      return this;
    },
    end: function (data?: string) {
      if (data) {
        this.write(data);
      }
      return this;
    },
  };

  res._json = res.json;
  res.json = function (data: unknown) {
    res.jsonCalled = true;
    return res._json(data);
  };

  res._status = res.status;
  res.status = function (code: number) {
    res.statusCalled = true;
    return res._status(code);
  };

  res._write = res.write;
  res.write = function (data: string) {
    res.writeCalled = true;
    return res._write(data);
  };

  res._end = res.end;
  res.end = function (data?: string) {
    res.endCalled = true;
    return res._end(data);
  };

  return res as MockResponse;
}

export function createMockStream(): PassThrough {
  return new PassThrough();
}

export const sampleOpenAIRequest: OpenAIRequest = {
  model: "gpt-4",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello, how are you?" },
  ],
  temperature: 0.7,
  max_tokens: 150,
};

export const sampleOpenAIRequestWithTools: OpenAIRequest = {
  model: "gpt-4",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What's the weather like in San Francisco?" },
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get the current weather in a given location",
        parameters: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "The city and state, e.g. San Francisco, CA",
            },
          },
          required: ["location"],
        },
      },
    },
  ],
};

export const sampleOllamaRequest: OllamaRequest = {
  model: "llama2",
  prompt: "Hello, how are you?",
  stream: false,
};

export const sampleOllamaMessagesRequest: OllamaRequest = {
  model: "llama2",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello, how are you?" },
  ],
  stream: false,
};

export const sampleOpenAIResponse: OpenAIResponse = {
  id: "chatcmpl-123",
  object: "chat.completion",
  created: 1677652288,
  model: "gpt-4",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content:
          "I'm doing well, thank you for asking! How can I help you today?",
      },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 20,
    completion_tokens: 15,
    total_tokens: 35,
  },
};

export const sampleOpenAIStreamChunks: OpenAIStreamChunk[] = [
  {
    id: "chatcmpl-123",
    object: "chat.completion.chunk",
    created: 1677652288,
    model: "gpt-4",
    choices: [
      {
        index: 0,
        delta: { role: "assistant" },
        finish_reason: null,
      },
    ],
  },
  {
    id: "chatcmpl-123",
    object: "chat.completion.chunk",
    created: 1677652288,
    model: "gpt-4",
    choices: [
      {
        index: 0,
        delta: { content: "I'm doing " },
        finish_reason: null,
      },
    ],
  },
  {
    id: "chatcmpl-123",
    object: "chat.completion.chunk",
    created: 1677652288,
    model: "gpt-4",
    choices: [
      {
        index: 0,
        delta: { content: "well, thank " },
        finish_reason: null,
      },
    ],
  },
  {
    id: "chatcmpl-123",
    object: "chat.completion.chunk",
    created: 1677652288,
    model: "gpt-4",
    choices: [
      {
        index: 0,
        delta: { content: "you for asking!" },
        finish_reason: null,
      },
    ],
  },
  {
    id: "chatcmpl-123",
    object: "chat.completion.chunk",
    created: 1677652288,
    model: "gpt-4",
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
  },
];

export const sampleOllamaResponse: OllamaResponse = {
  model: "llama2",
  created_at: "2023-11-06T21:00:00.000Z",
  response:
    "I'm an AI assistant, so I don't have feelings, but I'm functioning properly and ready to help you! How can I assist you today?",
  done: true,
};

export const sampleOllamaStreamChunks: OllamaStreamChunk[] = [
  {
    model: "llama2",
    created_at: "2023-11-06T21:00:00.000Z",
    response: "I'm an AI ",
    done: false,
  },
  {
    model: "llama2",
    created_at: "2023-11-06T21:00:00.000Z",
    response: "assistant, so I don't have ",
    done: false,
  },
  {
    model: "llama2",
    created_at: "2023-11-06T21:00:00.000Z",
    response: "feelings, but I'm functioning ",
    done: false,
  },
  {
    model: "llama2",
    created_at: "2023-11-06T21:00:00.000Z",
    response: "properly and ready to help you!",
    done: false,
  },
  {
    model: "llama2",
    created_at: "2023-11-06T21:00:00.000Z",
    response: " How can I assist you today?",
    done: true,
  },
];

export function formatSSE(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMockFetch(
  responseData: unknown, 
  status: number = 200
): () => Promise<MockFetchResponse> {
  return () => Promise.resolve({
    status,
    json: async () => await Promise.resolve(
      typeof responseData === "function" ? responseData() : responseData),
    text: async () => await Promise.resolve(JSON.stringify(
        typeof responseData === "function" ? responseData() : responseData,
      )),
    headers: new Map(),
  });
}