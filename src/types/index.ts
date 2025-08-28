/**
 * Type definitions index - exports all types used throughout ToolBridge
 */

// OpenAI types
export type * from './openai.js';

// Ollama types  
export type * from './ollama.js';

// ToolBridge core types
export type * from './toolbridge.js';

// Express extensions
declare global {
  namespace Express {
    interface Request {
      toolbridge?: {
        originalTools?: import('./openai.js').OpenAITool[];
        requestFormat?: import('./toolbridge.js').RequestFormat;
        backendFormat?: import('./toolbridge.js').RequestFormat;
      };
    }
  }
}

// Node.js stream extensions
declare module 'stream' {
  interface Readable {
    toolbridge?: {
      format?: import('./toolbridge.js').RequestFormat;
      tools?: import('./openai.js').OpenAITool[];
    };
  }
}

// Environment variables
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PROXY_HOST: string;
      PROXY_PORT: string;
      BACKEND_LLM_BASE_URL: string;
      BACKEND_LLM_API_KEY: string;
      OLLAMA_BASE_URL?: string;
      OLLAMA_DEFAULT_CONTEXT_LENGTH: string;
      DEBUG_MODE: string;
      ENABLE_TOOL_REINJECTION: string;
      TOOL_REINJECTION_MESSAGE_COUNT: string;
      TOOL_REINJECTION_TOKEN_COUNT: string;
      TOOL_REINJECTION_TYPE: string;
      MAX_STREAM_BUFFER_SIZE: string;
      STREAM_CONNECTION_TIMEOUT: string;
      HTTP_REFERER?: string;
      X_TITLE?: string;
    }
  }
}