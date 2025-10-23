/**
 * Ollama Client for Testing
 * 
 * Simple fetch-based client to test ToolBridge with Ollama format
 * Mimics OpenAI SDK patterns but uses Ollama API format
 */

import type OpenAI from "openai";

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  tools?: OllamaTool[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface OllamaToolCall {
  function: {
    name: string;
    arguments: string;
  };
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
}

export interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message?: {
    role: string;
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
}

export class OllamaClient {
  private readonly baseURL: string;
  private readonly apiKey: string | undefined;

  constructor(options: { baseURL: string; apiKey?: string }) {
    this.baseURL = options.baseURL.replace(/\/+$/, ''); // Remove trailing slashes
    this.apiKey = options.apiKey;
  }

  async chat(request: OllamaRequest): Promise<OllamaResponse> {
    const response = await this.makeRequest('/api/chat', {
      ...request,
      stream: false
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<OllamaResponse>;
  }

  async chatStream(request: OllamaRequest): Promise<AsyncIterable<OllamaStreamChunk>> {
    const response = await this.makeRequest('/api/chat', {
      ...request,
      stream: true
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    return this.parseStreamResponse(response);
  }

  private async makeRequest(endpoint: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return fetch(`${this.baseURL}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
  }

  private async *parseStreamResponse(response: Response): AsyncGenerator<OllamaStreamChunk, void, unknown> {
    if (!response.body) {
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            try {
              const chunk = JSON.parse(trimmed) as OllamaStreamChunk;
              yield chunk;
              
              if (chunk.done) {
                return;
              }
            } catch (error) {
              console.warn('Failed to parse streaming chunk:', trimmed, error);
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer.trim()) as OllamaStreamChunk;
          yield chunk;
        } catch (error) {
          console.warn('Failed to parse final chunk:', buffer, error);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// Helper function to convert OpenAI tools to Ollama format
export function convertOpenAIToolsToOllama(openaiTools: OpenAI.Chat.ChatCompletionTool[]): OllamaTool[] {
  return openaiTools.map(tool => {
    const result: OllamaTool = {
      type: 'function',
      function: {
        name: tool.function.name
      }
    };
    
    if (tool.function.description !== undefined) {
      result.function.description = tool.function.description;
    }
    
    if (tool.function.parameters) {
      // Convert OpenAI parameters to Ollama format
      const params = tool.function.parameters as Record<string, unknown>;
      if (params.type === 'object' && params.properties && typeof params.properties === 'object') {
        result.function.parameters = {
          type: 'object',
          properties: params.properties as Record<string, unknown>
        };
        
        if (params.required) {
          result.function.parameters.required = params.required as string[];
        }
      }
    }
    
    return result;
  });
}

// Helper function to convert OpenAI messages to Ollama format
export function convertOpenAIMessagesToOllama(openaiMessages: {
  role: string;
  content: string;
}[]): OllamaMessage[] {
  return openaiMessages.map(msg => ({
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content
  }));
}
