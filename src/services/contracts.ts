/**
 * Service Layer Contracts
 * 
 * Defines the interfaces between HTTP handlers and business logic.
 * All handlers MUST use these services instead of directly calling utilities.
 */

import type { LLMProvider } from '../translation/types/index.js';
import type { OpenAITool, RequestFormat } from '../types/index.js';
import type { Readable } from 'stream';

/**
 * Request context extracted from HTTP layer
 */
export interface RequestContext {
    clientFormat: RequestFormat;
    backendFormat: RequestFormat;
    tools: OpenAITool[];
    stream: boolean;
    authHeader?: string;
    headers: Record<string, string | string[] | undefined>;
}

/**
 * Translation service - handles all format conversions
 */
export interface TranslationService {
    translateRequest(
        request: unknown,
        from: LLMProvider,
        to: LLMProvider,
        toolNames: string[]
    ): Promise<unknown>;

    translateResponse(
        response: unknown,
        from: LLMProvider,
        to: LLMProvider,
        toolNames: string[]
    ): Promise<unknown>;

    translateStream(
        stream: Readable,
        from: LLMProvider,
        to: LLMProvider,
        tools: OpenAITool[],
        streamOptions?: { include_usage?: boolean }
    ): Readable;
}

/**
 * Backend service - handles communication with LLM providers
 */
export interface BackendService {
    sendRequest(
        payload: unknown,
        stream: boolean,
        format: RequestFormat,
        provider: string,
        authHeader?: string,
        headers?: Record<string, string | string[] | undefined>
    ): Promise<unknown | Readable>;
}

/**
 * Configuration service - single source for all config
 */
export interface ConfigService {
    getBackendUrl(): string;
    getBackendApiKey(): string;
    getBackendMode(): 'openai' | 'ollama';
    getProxyPort(): number;
    getProxyHost(): string;
    isDebugMode(): boolean;
    shouldPassTools(): boolean;
    getToolReinjectionConfig(): {
        enabled: boolean;
        messageCount: number;
        tokenCount: number;
        type: 'system' | 'user';
    };
}

/**
 * Format detection service
 */
export interface FormatDetectionService {
    detectRequestFormat(body: unknown, headers: Record<string, string | string[] | undefined>): RequestFormat;
    detectResponseFormat(response: unknown): RequestFormat;
    determineProvider(format: RequestFormat, url: string): 'openai' | 'ollama';
    getProviderFromFormat(format: RequestFormat): LLMProvider;
}
