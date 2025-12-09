/**
 * Translation Engine Types
 *
 * Type definitions for the translation engine interfaces.
 */

import type { TranslationError } from './generic.js';
import type {
  LLMProvider,
  ConversionContext,
  CompatibilityResult,
} from './index.js';

/**
 * Translation request options
 */
export interface TranslationOptions {
  from: LLMProvider;
  to: LLMProvider;
  request: unknown;
  context?: Partial<ConversionContext>;
  strict?: boolean; // Fail on unsupported features vs graceful degradation
  preserveExtensions?: boolean;
}

/**
 * Translation result
 */
export interface TranslationResult {
  success: boolean;
  data?: unknown;
  error?: TranslationError;
  compatibility: CompatibilityResult;
  context: ConversionContext;
  transformations: Array<{
    step: string;
    description: string;
    timestamp: number;
  }>;
}

/**
 * Streaming translation options
 */
export interface StreamTranslationOptions extends TranslationOptions {
  sourceStream: ReadableStream<unknown>;
}

/**
 * Stream translation result
 */
export interface StreamTranslationResult {
  success: boolean;
  stream?: ReadableStream<unknown>;
  error?: TranslationError;
  compatibility: CompatibilityResult;
  context: ConversionContext;
}
