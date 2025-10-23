/**
 * Provider-specific types and mappings
 *
 * This file defines the specific types and configurations for each
 * supported LLM provider, including their capabilities and parameter mappings.
 */
// Default parameter mappings
export const PARAMETER_MAPPINGS = {
    maxTokens: {
        openai: 'max_tokens',
        azure: 'max_tokens',
        ollama: 'num_predict',
    },
    temperature: {
        openai: 'temperature',
        azure: 'temperature',
        ollama: 'temperature',
        validator: (value) => value >= 0 && value <= 2,
    },
    topP: {
        openai: 'top_p',
        azure: 'top_p',
        ollama: 'top_p',
        validator: (value) => value >= 0 && value <= 1,
    },
    topK: {
        ollama: 'top_k',
        validator: (value) => value >= 1,
    },
    presencePenalty: {
        openai: 'presence_penalty',
        azure: 'presence_penalty',
        validator: (value) => value >= -2 && value <= 2,
    },
    frequencyPenalty: {
        openai: 'frequency_penalty',
        azure: 'frequency_penalty',
        validator: (value) => value >= -2 && value <= 2,
    },
    repetitionPenalty: {
        ollama: 'repeat_penalty',
        transformer: (value, targetProvider) => {
            // Convert from OpenAI-style (-2 to 2) to Ollama-style (0.1 to 2.0)
            if (targetProvider === 'ollama' && value !== undefined) {
                return Math.max(0.1, Math.min(2.0, 1 + value / 2));
            }
            return value;
        },
    },
    seed: {
        openai: 'seed',
        azure: 'seed',
        ollama: 'seed',
        validator: (value) => Number.isInteger(value),
    },
    stop: {
        openai: 'stop',
        azure: 'stop',
        ollama: 'stop',
    },
    stream: {
        openai: 'stream',
        azure: 'stream',
        ollama: 'stream',
    },
};
// Provider capabilities definitions
export const PROVIDER_CAPABILITIES = {
    openai: {
        streaming: true,
        toolCalls: true,
        functionCalls: true, // Legacy support
        multipleChoices: true,
        logprobs: true,
        jsonMode: true,
        structuredOutputs: true,
        imageInputs: true,
        audioInputs: true,
        seedSupport: true,
        parallelToolCalls: true,
        customParameters: [
            'user', 'logit_bias', 'logprobs', 'top_logprobs', 'n', 'best_of',
            'presence_penalty', 'frequency_penalty', 'response_format'
        ],
    },
    azure: {
        streaming: true,
        toolCalls: true,
        functionCalls: true,
        multipleChoices: true,
        logprobs: true,
        jsonMode: true,
        structuredOutputs: true,
        imageInputs: true,
        audioInputs: false, // Usually not supported
        seedSupport: true,
        parallelToolCalls: true,
        customParameters: [
            'user', 'logit_bias', 'logprobs', 'top_logprobs', 'n',
            'presence_penalty', 'frequency_penalty', 'response_format',
            'dataSources', 'enhancements' // Azure-specific
        ],
    },
    ollama: {
        streaming: true,
        toolCalls: false, // Limited support
        functionCalls: false,
        multipleChoices: false,
        logprobs: false,
        jsonMode: true,
        structuredOutputs: false,
        imageInputs: true, // Model dependent
        audioInputs: false,
        seedSupport: true,
        parallelToolCalls: false,
        customParameters: [
            'num_predict', 'num_ctx', 'repeat_penalty', 'top_k',
            'mirostat', 'mirostat_eta', 'mirostat_tau', 'tfs_z',
            'keep_alive'
        ],
    },
};
// Common model mappings
export const MODEL_MAPPINGS = [
    {
        generic: 'gpt-4o',
        openai: 'gpt-4o',
        azure: ['gpt-4o', 'gpt4o'],
        aliases: ['gpt4o', 'gpt-4-omni'],
    },
    {
        generic: 'gpt-4o-mini',
        openai: 'gpt-4o-mini',
        azure: ['gpt-4o-mini', 'gpt4o-mini'],
        aliases: ['gpt4o-mini'],
    },
    {
        generic: 'gpt-4-turbo',
        openai: 'gpt-4-turbo',
        azure: ['gpt-4-turbo', 'gpt4-turbo'],
    },
    {
        generic: 'gpt-3.5-turbo',
        openai: 'gpt-3.5-turbo',
        azure: ['gpt-35-turbo', 'gpt-35-turbo'],
    },
    {
        generic: 'llama3.1',
        ollama: ['llama3.1:8b', 'llama3.1:70b', 'llama3.1:405b'],
        capabilities: {
            toolCalls: false,
            structuredOutputs: false,
        },
    },
    {
        generic: 'llama3.2',
        ollama: ['llama3.2:1b', 'llama3.2:3b', 'llama3.2:11b', 'llama3.2:90b'],
    },
    {
        generic: 'codellama',
        ollama: ['codellama:7b', 'codellama:13b', 'codellama:34b'],
    },
    {
        generic: 'mistral',
        ollama: ['mistral:7b', 'mistral:latest'],
    },
];
// Compatibility rules between providers
export const COMPATIBILITY_MATRIX = [
    {
        from: 'openai',
        to: 'azure',
        features: {
            toolCalls: { supported: true },
            streaming: { supported: true },
            jsonMode: { supported: true },
            multipleChoices: { supported: true },
            logprobs: { supported: true },
            structuredOutputs: { supported: true },
            imageInputs: { supported: true },
            audioInputs: {
                supported: false,
                warning: 'Audio inputs not typically supported in Azure OpenAI'
            },
        },
    },
    {
        from: 'openai',
        to: 'ollama',
        features: {
            toolCalls: {
                supported: false,
                fallback: null,
                warning: 'Tool calls will be converted to text instructions'
            },
            streaming: { supported: true },
            jsonMode: { supported: true },
            multipleChoices: {
                supported: false,
                fallback: 1,
                warning: 'Multiple choices not supported, using n=1'
            },
            logprobs: {
                supported: false,
                warning: 'Log probabilities not available in Ollama'
            },
            structuredOutputs: {
                supported: false,
                transformation: 'Convert to JSON mode with instructions'
            },
        },
    },
    {
        from: 'ollama',
        to: 'openai',
        features: {
            streaming: { supported: true },
            jsonMode: { supported: true },
            customParameters: {
                supported: false,
                warning: 'Ollama-specific parameters will be ignored'
            },
        },
    },
    {
        from: 'azure',
        to: 'openai',
        features: {
            toolCalls: { supported: true },
            streaming: { supported: true },
            jsonMode: { supported: true },
            dataSources: {
                supported: false,
                warning: 'Azure Data Sources will be ignored'
            },
        },
    },
];
export const ENDPOINT_PATTERNS = [
    // OpenAI patterns
    {
        pattern: /^\/v1\/chat\/completions$/,
        provider: 'openai',
    },
    {
        pattern: /^\/v1\/completions$/,
        provider: 'openai',
    },
    // Azure patterns
    {
        pattern: /^\/openai\/deployments\/([^/]+)\/chat\/completions$/,
        provider: 'azure',
        extractDeployment: (path) => {
            const match = path.match(/\/deployments\/([^/]+)\//);
            return match?.[1] ?? null;
        },
    },
    {
        pattern: /^\/openai\/deployments\/([^/]+)\/completions$/,
        provider: 'azure',
        extractDeployment: (path) => {
            const match = path.match(/\/deployments\/([^/]+)\//);
            return match?.[1] ?? null;
        },
    },
    // Ollama patterns
    {
        pattern: /^\/api\/chat$/,
        provider: 'ollama',
    },
    {
        pattern: /^\/api\/generate$/,
        provider: 'ollama',
    },
    {
        pattern: /^\/v1\/chat\/completions$/,
        provider: 'ollama', // Ollama OpenAI compatibility
    },
];
export * from './generic.js';
