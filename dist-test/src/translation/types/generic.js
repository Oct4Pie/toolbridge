/**
 * Generic LLM Schema - Universal format for cross-provider translation
 *
 * This schema serves as the intermediary format that can represent requests
 * and responses from any LLM provider (OpenAI, Azure, Ollama, etc).
 * Each provider converter translates to/from this generic format.
 */
// Error types for translation
export class TranslationError extends Error {
    code;
    context;
    originalError;
    constructor(message, code, context, originalError) {
        super(message);
        this.code = code;
        this.context = context;
        this.originalError = originalError;
        this.name = 'TranslationError';
    }
}
export class UnsupportedFeatureError extends TranslationError {
    constructor(feature, provider, context) {
        super(`Feature '${feature}' is not supported by provider '${provider}'`, 'UNSUPPORTED_FEATURE', context);
    }
}
// All types are exported inline above
