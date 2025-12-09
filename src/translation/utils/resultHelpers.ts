/**
 * Translation Result Helpers
 *
 * Utility functions for creating consistent translation results.
 */

import { TranslationError } from '../types/generic.js';

import type {
  ConversionContext,
  CompatibilityResult,
} from '../types/index.js';
import type {
  TranslationResult,
  StreamTranslationResult,
} from '../types/translator.js';

/**
 * Create a successful passthrough result (same provider, no conversion needed)
 */
export function createPassthroughResult(
  data: unknown,
  context: ConversionContext
): TranslationResult {
  return {
    success: true,
    data,
    compatibility: { compatible: true, warnings: [], unsupportedFeatures: [], transformations: [] },
    context,
    transformations: []
  };
}

/**
 * Create a successful translation result
 */
export function createSuccessResult(
  data: unknown,
  compatibility: CompatibilityResult,
  context: ConversionContext
): TranslationResult {
  return {
    success: true,
    data,
    compatibility,
    context,
    transformations: context.transformationLog ?? []
  };
}

/**
 * Create an error translation result
 */
export function createErrorResult(
  error: unknown,
  context: ConversionContext
): TranslationResult {
  const translationError = error instanceof Error
    ? new TranslationError(error.message, 'CONVERSION_FAILED', context, error)
    : new TranslationError('Unknown conversion error', 'CONVERSION_FAILED', context);

  return {
    success: false,
    error: translationError,
    compatibility: { compatible: false, warnings: [], unsupportedFeatures: [], transformations: [] },
    context,
    transformations: context.transformationLog ?? []
  };
}

/**
 * Create a successful stream passthrough result
 */
export function createStreamPassthroughResult(
  stream: ReadableStream<unknown>,
  context: ConversionContext
): StreamTranslationResult {
  return {
    success: true,
    stream,
    compatibility: { compatible: true, warnings: [], unsupportedFeatures: [], transformations: [] },
    context
  };
}

/**
 * Create a successful stream translation result
 */
export function createStreamSuccessResult(
  stream: ReadableStream<unknown>,
  compatibility: CompatibilityResult,
  context: ConversionContext
): StreamTranslationResult {
  return {
    success: true,
    stream,
    compatibility,
    context
  };
}

/**
 * Create an error stream translation result
 */
export function createStreamErrorResult(
  error: unknown,
  context: ConversionContext
): StreamTranslationResult {
  const translationError = error instanceof Error
    ? new TranslationError(error.message, 'CONVERSION_FAILED', context, error)
    : new TranslationError('Stream conversion error', 'CONVERSION_FAILED', context);

  return {
    success: false,
    error: translationError,
    compatibility: { compatible: false, warnings: [], unsupportedFeatures: [], transformations: [] },
    context
  };
}
