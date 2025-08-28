/**
 * ToolBridge Core Types
 */

import type { OpenAITool } from './openai.js';

export type RequestFormat = 'openai' | 'ollama';

export interface ToolCallDetectionResult {
  isPotential: boolean;
  isCompletedXml: boolean;
  rootTagName: string | null;
  confidence: number;
  mightBeToolCall: boolean;
}

export interface ExtractedToolCall {
  name: string;
  arguments: Record<string, unknown> | string;
}

export interface BackendPayload {
  model: string;
  messages?: Array<{
    role: string;
    content: string;
  }>;
  prompt?: string; // For Ollama format
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: unknown;
  functions?: unknown;
  function_call?: unknown;
  options?: Record<string, unknown>; // For Ollama options
  template?: string; // For Ollama template
  [key: string]: unknown;
}

export interface StreamProcessor {
  res?: import('express').Response | undefined;
  processChunk(chunk: Buffer | string): void;
  setTools?(tools: OpenAITool[]): void;
  handleDone?(): void;
  end(): void;
  closeStream?(message?: string | null): void;
  closeStreamWithError?(errorMessage: string): void;
  pipeFrom?(stream: NodeJS.ReadableStream): void;
}

export interface WrapperAwareStreamProcessor extends StreamProcessor {
  buffer: string;
  inWrapper: boolean;
  wrapperContent: string;
  beforeWrapperContent: string;
  knownToolNames: string[];
  unwrappedBuffer: string;
  checkingUnwrapped: boolean;
  originalProcessor: StreamProcessor;
}

export interface ToolCallHandlerConfig {
  enableToolReinjection: boolean;
  toolReinjectionMessageCount: number;
  toolReinjectionTokenCount: number;
  toolReinjectionType: 'system' | 'user';
}

export interface ProxyConfig {
  proxyPort: number;
  proxyHost: string;
  backendLlmBaseUrl: string;
  backendLlmApiKey: string;
  debugMode: boolean;
  maxStreamBufferSize: number;
  streamConnectionTimeout: number;
  ollamaBaseUrl?: string;
  ollamaDefaultContextLength: number;
}

// Error types
export interface BackendError extends Error {
  status?: number;
  response?: {
    status: number;
    data: unknown;
  };
  request?: unknown;
}

// Request context
export interface RequestContext {
  clientRequestFormat: RequestFormat;
  backendTargetFormat: RequestFormat;
  originalTools: OpenAITool[];
  clientRequestedStream: boolean;
  clientAuthHeader: string;
  clientHeaders: Record<string, string>;
}

// XML parsing specific types
export interface XMLParserStrategy {
  canHandle(text: string, toolName: string): boolean;
  extract(text: string, toolName: string): ExtractedToolCall | null;
}

export interface XMLParsingResult {
  success: boolean;
  toolCall: ExtractedToolCall | null;
  strategy: string;
  error?: string;
}

// Stream chunk types for internal processing
export interface InternalStreamChunk {
  type: 'content' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: ExtractedToolCall;
  error?: string;
  metadata?: {
    chunkIndex: number;
    timestamp: number;
  };
}

// Partial tool call extraction types
export interface PartialToolCallState {
  rootTag: string | null;
  isPotential: boolean;
  mightBeToolCall: boolean;
  buffer: string;
  identifiedToolName: string | null;
}

export interface PartialExtractionResult {
  complete: boolean;
  toolCall?: ExtractedToolCall;
  content?: string;
  partialState?: PartialToolCallState;
}