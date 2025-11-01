/**
 * Provider Capabilities Map
 *
 * Centralized definition of which advanced features each upstream provider supports.
 * This enables feature-gating and safe field dropping before forwarding requests.
 */

import { logger } from '../../logging/index.js';

import type { OpenAIRequest } from '../../types/openai.js';

export interface ProviderCapabilities {
  /** Supports response_format with JSON schema */
  supportsJsonSchema: boolean;
  /** Supports stream_options.include_usage for final usage chunk */
  supportsStreamUsageChunk: boolean;
  /** Supports logprobs field */
  supportsLogprobs: boolean;
  /** Supports seed for deterministic output */
  supportsSeed: boolean;
  /** Supports n (number of completions) */
  supportsN: boolean;
  /** Supports frequency_penalty */
  supportsFrequencyPenalty: boolean;
  /** Supports presence_penalty */
  supportsPresencePenalty: boolean;
  /** Supports top_logprobs */
  supportsTopLogprobs: boolean;
  /** Supports user field for user tracking */
  supportsUser: boolean;
}

export const CAPABILITIES: Record<string, ProviderCapabilities> = {
  'openai': {
    supportsJsonSchema: true,
    supportsStreamUsageChunk: true,
    supportsLogprobs: true,
    supportsSeed: true,
    supportsN: true,
    supportsFrequencyPenalty: true,
    supportsPresencePenalty: true,
    supportsTopLogprobs: true,
    supportsUser: true,
  },
  'ollama-native': {
    supportsJsonSchema: false, // Ollama native uses `format` field, not response_format
    supportsStreamUsageChunk: false, // Not in line-JSON format
    supportsLogprobs: false,
    supportsSeed: false,
    supportsN: false,
    supportsFrequencyPenalty: false,
    supportsPresencePenalty: false,
    supportsTopLogprobs: false,
    supportsUser: false,
  },
  'ollama-compat': {
    // Ollama's OpenAI-compat mode; most fields experimental
    supportsJsonSchema: false, // Uses format field
    supportsStreamUsageChunk: false,
    supportsLogprobs: false,
    supportsSeed: false,
    supportsN: false,
    supportsFrequencyPenalty: false,
    supportsPresencePenalty: false,
    supportsTopLogprobs: false,
    supportsUser: false,
  },
};

/**
 * Filter an OpenAI request to remove unsupported fields for the target provider.
 * @param request Original OpenAI request
 * @param provider Provider key (e.g., 'openai', 'ollama-native')
 * @returns Filtered request with unsupported fields removed
 */
export function filterRequestByCapabilities(
  request: OpenAIRequest,
  provider: string,
): OpenAIRequest {
  const caps = CAPABILITIES[provider];
  if (!caps) {
    logger.warn(`[CAPABILITIES] Unknown provider: ${provider}. Passing request as-is.`);
    return request;
  }

  const filtered: OpenAIRequest = { ...request };

  // Feature-gate response_format
  if (!caps.supportsJsonSchema && filtered.response_format !== undefined) {
    logger.debug(
      `[CAPABILITIES] Provider ${provider} does not support response_format. Removing.`,
    );
    delete filtered.response_format;
  }

  // Feature-gate stream_options.include_usage
  if (!caps.supportsStreamUsageChunk && filtered.stream_options?.include_usage) {
    logger.debug(
      `[CAPABILITIES] Provider ${provider} does not support stream_options.include_usage. Removing.`,
    );
    if (filtered.stream_options) {
      delete filtered.stream_options.include_usage;
      if (Object.keys(filtered.stream_options).length === 0) {
        delete filtered.stream_options;
      }
    }
  }

  // Feature-gate logprobs
  if (!caps.supportsLogprobs && filtered.logprobs !== undefined) {
    logger.debug(
      `[CAPABILITIES] Provider ${provider} does not support logprobs. Removing.`,
    );
    delete filtered.logprobs;
  }

  // Feature-gate top_logprobs
  if (!caps.supportsTopLogprobs && filtered.top_logprobs !== undefined) {
    logger.debug(
      `[CAPABILITIES] Provider ${provider} does not support top_logprobs. Removing.`,
    );
    delete filtered.top_logprobs;
  }

  // Feature-gate seed
  if (!caps.supportsSeed && filtered.seed !== undefined) {
    logger.debug(
      `[CAPABILITIES] Provider ${provider} does not support seed. Removing.`,
    );
    delete filtered.seed;
  }

  // Feature-gate n (number of completions)
  if (!caps.supportsN && filtered.n !== undefined) {
    logger.debug(
      `[CAPABILITIES] Provider ${provider} does not support n. Removing.`,
    );
    delete filtered.n;
  }

  // Feature-gate frequency_penalty
  if (!caps.supportsFrequencyPenalty && filtered.frequency_penalty !== undefined) {
    logger.debug(
      `[CAPABILITIES] Provider ${provider} does not support frequency_penalty. Removing.`,
    );
    delete filtered.frequency_penalty;
  }

  // Feature-gate presence_penalty
  if (!caps.supportsPresencePenalty && filtered.presence_penalty !== undefined) {
    logger.debug(
      `[CAPABILITIES] Provider ${provider} does not support presence_penalty. Removing.`,
    );
    delete filtered.presence_penalty;
  }

  // Feature-gate user field
  if (!caps.supportsUser && filtered.user !== undefined) {
    logger.debug(
      `[CAPABILITIES] Provider ${provider} does not support user field. Removing.`,
    );
    delete filtered.user;
  }

  return filtered;
}
