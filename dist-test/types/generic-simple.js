/**
 * Generic Schema Types - Simplified Working Version
 *
 * Universal LLM schema that can represent any provider's requests and responses.
 * This serves as the translation intermediary between all providers.
 */
// Error types
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
