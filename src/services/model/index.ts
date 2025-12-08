/**
 * Model Service
 *
 * Backend-agnostic model management with automatic format translation.
 * Orchestrates fetching, conversion, and formatting of model data.
 *
 * SSOT for all model listing and info retrieval operations.
 */

import { createHash } from 'crypto';

import { logger } from '../../logging/index.js';
import { modelConverter } from '../../translation/converters/modelConverter.js';
import { configService } from '../configService.js';

import { modelFetcher, type ModelFetcher } from './ModelFetcher.js';
import { modelFormatter } from './ModelFormatter.js';

import type { UniversalModel } from '../../translation/types/models.js';
import type { ShowResponse } from '../../types/generated/ollama/show.js';
import type { TagsResponse } from '../../types/generated/ollama/tags.js';
import type {
  ModelsListResponse,
  Datum as OpenAIModel,
} from '../../types/generated/openai/models-list.js';
import type { ModelService } from '../contracts.js';

class ModelServiceImpl implements ModelService {
  private readonly cache = new Map<string, UniversalModel[]>();
  private readonly inFlightFetches = new Map<string, Promise<UniversalModel[]>>();

  constructor(private readonly fetcher: ModelFetcher = modelFetcher) {}

  /**
   * Generate a deterministic cache key without leaking auth credentials
   */
  private buildCacheKey(backendMode: 'openai' | 'ollama', authHeader?: string): string {
    const normalized = authHeader?.trim();
    if (!normalized) {
      return `${backendMode}:default`;
    }

    const hash = createHash('sha256').update(normalized).digest('hex');
    return `${backendMode}:${hash}`;
  }

  private describeCacheKey(cacheKey: string): string {
    const [, suffix] = cacheKey.split(':');
    if (!suffix) {
      return cacheKey;
    }
    return suffix.length > 8 ? suffix.slice(0, 8) : suffix;
  }

  private async fetchAndCacheModels(
    backendMode: 'openai' | 'ollama',
    authHeader?: string,
  ): Promise<UniversalModel[]> {
    const cacheKey = this.buildCacheKey(backendMode, authHeader);

    const cachedModels = this.cache.get(cacheKey);
    if (cachedModels) {
      logger.debug(
        `[ModelService] Cache hit for ${backendMode} models (key=${this.describeCacheKey(cacheKey)})`,
      );
      return cachedModels;
    }

    const pendingFetch = this.inFlightFetches.get(cacheKey);
    if (pendingFetch) {
      logger.debug(
        `[ModelService] Awaiting in-flight fetch for ${backendMode} models (key=${this.describeCacheKey(cacheKey)})`,
      );
      return pendingFetch;
    }

    logger.debug(
      `[ModelService] Cache miss for ${backendMode} models (key=${this.describeCacheKey(cacheKey)})`,
    );

    const fetchPromise = (async () => {
      try {
        const models = backendMode === 'ollama'
          ? await this.fetcher.fetchOllamaModels(authHeader)
          : await this.fetcher.fetchOpenAIModels(authHeader);

        this.cache.set(cacheKey, models);
        logger.info(
          `[ModelService] Cached ${models.length} ${backendMode} models (key=${this.describeCacheKey(cacheKey)})`,
        );
        return models;
      } catch (error) {
        logger.error(
          `[ModelService] Failed to fetch ${backendMode} models (key=${this.describeCacheKey(cacheKey)})`,
          error,
        );
        throw error;
      } finally {
        this.inFlightFetches.delete(cacheKey);
      }
    })();

    this.inFlightFetches.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * List all models from the backend in the specified output format
   */
  async listModels(
    outputFormat: 'openai' | 'ollama',
    authHeader?: string
  ): Promise<ModelsListResponse | TagsResponse> {
    const backendMode = configService.getBackendMode();

    logger.debug(`[ModelService] Listing models: backend=${backendMode}, outputFormat=${outputFormat}`);

    // Fetch models from backend
    const universalModels = await this.getUniversalModels(authHeader);

    // Translate to requested format
    if (outputFormat === 'ollama') {
      return modelFormatter.formatAsOllamaResponse(universalModels);
    } else {
      return modelFormatter.formatAsOpenAIResponse(universalModels);
    }
  }

  /**
   * Get model info in the specified output format
   */
  async getModelInfo(
    modelName: string,
    outputFormat: 'openai' | 'ollama',
    authHeader?: string
  ): Promise<ShowResponse | OpenAIModel> {
    const backendMode = configService.getBackendMode();

    logger.debug(`[ModelService] Getting model info: model=${modelName}, backend=${backendMode}, outputFormat=${outputFormat}`);

    if (backendMode === 'ollama' && outputFormat === 'ollama') {
      // Backend is Ollama and caller wants Ollama format – fetch directly
      return this.fetcher.fetchOllamaModelInfo(modelName, authHeader);
    }

    // For all other cases, work through the universal representation
    const universalModels = await this.getUniversalModels(authHeader);
    const model = universalModels.find((m) => m.id === modelName);

    if (!model) {
      throw new Error(`Model not found: ${modelName}`);
    }

    if (outputFormat === 'ollama') {
      return modelFormatter.createOllamaModelInfo(model);
    }

    return modelConverter.toOpenAI(model);
  }

  async preloadModelCache(authHeader?: string): Promise<void> {
    const backendMode = configService.getBackendMode();
    await this.fetchAndCacheModels(backendMode, authHeader);
  }

  /**
   * Get models in universal format (no translation)
   */
  async getUniversalModels(authHeader?: string): Promise<UniversalModel[]> {
    const backendMode = configService.getBackendMode();
    return this.fetchAndCacheModels(backendMode, authHeader);
  }
}

/**
 * Singleton instance
 */
export const modelService = new ModelServiceImpl();

// Export types and classes for testing
export { ModelServiceImpl };
export type { ModelService };
