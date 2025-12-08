/**
 * Ollama Helper Functions
 *
 * Utility functions for Ollama converter operations.
 * Includes ID generation, timestamp parsing, extension extraction, and tool call normalization.
 */

import { MODEL_MAPPINGS } from '../../types/providers.js';
import { isRecord, type UnknownRecord } from '../../utils/typeGuards.js';

import type { OllamaRequest } from '../../../types/ollama.js';

/**
 * Generate unique ID for Ollama responses
 */
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Parse Ollama timestamp to Unix timestamp
 */
export function parseOllamaTimestamp(timestamp: unknown): number {
  if (typeof timestamp === 'string') {
    return Math.floor(new Date(timestamp).getTime() / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

/**
 * Extract Ollama-specific extensions from request
 */
export function extractOllamaExtensions(request: Partial<OllamaRequest>): UnknownRecord {
  const extensions: UnknownRecord = {};

  if (typeof request.options?.num_predict === 'number') {
    extensions['numPredict'] = request.options.num_predict;
  }
  if (typeof request.options?.num_ctx === 'number') {
    extensions['numCtx'] = request.options.num_ctx;
  }
  if (request.keep_alive !== undefined) {
    extensions['keepAlive'] = request.keep_alive;
  }

  return extensions;
}

/**
 * Normalize Ollama tool calls to standard format
 */
export function normalizeOllamaToolCalls(
  rawToolCalls: unknown
): Array<{ id?: string; name: string; arguments: string | Record<string, unknown> }> {
  if (!Array.isArray(rawToolCalls)) {
    return [];
  }

  const normalized: Array<{ id?: string; name: string; arguments: string | Record<string, unknown> }> = [];

  for (const entry of rawToolCalls) {
    if (!isRecord(entry)) {
      continue;
    }

    const functionCandidate = isRecord(entry['function'])
      ? entry['function'] as UnknownRecord
      : isRecord(entry['function_call'])
        ? entry['function_call'] as UnknownRecord
        : undefined;

    const nameCandidate = typeof functionCandidate?.['name'] === 'string'
      ? functionCandidate['name'] as string
      : typeof entry['name'] === 'string'
        ? entry['name'] as string
        : undefined;

    if (!nameCandidate) {
      continue;
    }

    const idCandidate = typeof entry['id'] === 'string'
      ? entry['id'] as string
      : typeof functionCandidate?.['id'] === 'string'
        ? functionCandidate['id'] as string
        : undefined;

    let argumentSource: unknown = functionCandidate?.['arguments'];
    if (argumentSource === undefined) {
      argumentSource = entry['arguments'];
    }

    let normalizedArguments: string | Record<string, unknown>;
    if (typeof argumentSource === 'string') {
      normalizedArguments = argumentSource;
    } else if (isRecord(argumentSource)) {
      normalizedArguments = argumentSource as Record<string, unknown>;
    } else if (argumentSource !== undefined) {
      try {
        normalizedArguments = JSON.stringify(argumentSource);
      } catch {
        normalizedArguments = '{}';
      }
    } else {
      normalizedArguments = '{}';
    }

    const normalizedEntry: { id?: string; name: string; arguments: string | Record<string, unknown> } = {
      name: nameCandidate,
      arguments: normalizedArguments,
    };

    if (typeof idCandidate === 'string') {
      normalizedEntry.id = idCandidate;
    }

    normalized.push(normalizedEntry);
  }

  return normalized;
}

/**
 * Resolve generic model name to Ollama model name
 */
export async function resolveModel(model: string): Promise<string> {
  await Promise.resolve(); // Satisfy async requirement
  const mapping = MODEL_MAPPINGS.find(m => m.generic === model);
  if (mapping?.ollama !== undefined && Array.isArray(mapping.ollama) && mapping.ollama.length > 0) {
    const firstModel = mapping.ollama[0];
    if (firstModel) {
      return firstModel;
    }
  }
  return model;
}

/**
 * Normalize Ollama model name to generic name
 */
export async function normalizeModel(model: string): Promise<string> {
  await Promise.resolve(); // Satisfy async requirement
  const mapping = MODEL_MAPPINGS.find(m => {
    if (m.ollama === undefined || !Array.isArray(m.ollama)) {
      return false;
    }
    return m.ollama.includes(model) || m.ollama.some(variant => {
      const baseModel = model.split(':')[0];
      return baseModel !== undefined && variant.startsWith(baseModel);
    });
  });
  if (mapping !== undefined) {
    return mapping.generic;
  }
  return model;
}
