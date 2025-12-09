/**
 * Model Fetcher
 *
 * Handles HTTP operations for fetching models from OpenAI and Ollama backends.
 * Delegates format conversion to modelConverter.
 */

import axios from 'axios';

import { OLLAMA_ENDPOINTS, OPENAI_ENDPOINTS } from '../../constants/endpoints.js';
import { logger } from '../../logging/index.js';
import { modelConverter } from '../../translation/converters/modelConverter.js';
import { configService } from '../configService.js';

import type {
  OpenAIModelsResponse,
  OllamaModelsResponse,
  OllamaModelInfo,
  UniversalModel,
} from '../../translation/types/models.js';

export class ModelFetcher {
  /**
   * Fetch models from OpenAI backend and convert to universal format
   */
  async fetchOpenAIModels(authHeader?: string): Promise<UniversalModel[]> {
    const backendUrl = configService.getBackendUrl();
    const apiKey = authHeader ?? `Bearer ${configService.getBackendApiKey()}`;

    logger.debug(`[ModelFetcher] Fetching OpenAI models from ${backendUrl}/models`);

    try {
      const response = await axios.get<OpenAIModelsResponse>(
        `${backendUrl}${OPENAI_ENDPOINTS.MODELS}`,
        {
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      // Validate response structure before accessing
      const responseData = response.data;
      if (!responseData || !Array.isArray(responseData.data)) {
        logger.error('[ModelFetcher] Invalid response structure: missing or non-array data field');
        throw new Error('Invalid response from OpenAI backend: expected data array');
      }

      logger.debug(`[ModelFetcher] Fetched ${responseData.data.length} models from OpenAI backend`);

      // Convert all OpenAI models to universal format
      return responseData.data.map(model => modelConverter.fromOpenAI(model));
    } catch (error) {
      const axiosError = error as {response?: {status?: number; data?: unknown; headers?: unknown}; message?: string};
      logger.error(`[ModelFetcher] Failed to fetch OpenAI models from ${backendUrl}${OPENAI_ENDPOINTS.MODELS}`);
      logger.error(`[ModelFetcher] Status: ${axiosError.response?.status ?? 'N/A'}`);
      logger.error(`[ModelFetcher] Error: ${axiosError.message ?? 'Unknown'}`);
      logger.error(`[ModelFetcher] Response data: ${JSON.stringify(axiosError.response?.data ?? {})}`);
      throw new Error(`Failed to fetch models from OpenAI backend: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch models from Ollama backend and convert to universal format
   */
  async fetchOllamaModels(authHeader?: string): Promise<UniversalModel[]> {
    const backendUrl = configService.getOllamaBackendUrl();

    logger.debug(`[ModelFetcher] Fetching Ollama models from ${backendUrl}${OLLAMA_ENDPOINTS.TAGS}`);

    try {
      const response = await axios.get<OllamaModelsResponse>(
        `${backendUrl}${OLLAMA_ENDPOINTS.TAGS}`,
        {
          headers: authHeader ? { 'Authorization': authHeader } : {},
          timeout: 30000,
        }
      );

      // Validate response structure before accessing
      const responseData = response.data;
      if (!responseData || !Array.isArray(responseData.models)) {
        logger.error('[ModelFetcher] Invalid response structure: missing or non-array models field');
        throw new Error('Invalid response from Ollama backend: expected models array');
      }

      logger.debug(`[ModelFetcher] Fetched ${responseData.models.length} models from Ollama backend`);

      // Convert all Ollama models to universal format
      return responseData.models.map(model => modelConverter.fromOllama(model));
    } catch (error) {
      logger.error(`[ModelFetcher] Failed to fetch Ollama models:`, error);
      throw new Error(`Failed to fetch models from Ollama backend: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch model info from Ollama backend
   */
  async fetchOllamaModelInfo(modelName: string, authHeader?: string): Promise<OllamaModelInfo> {
    const backendUrl = configService.getOllamaBackendUrl();

    logger.debug(`[ModelFetcher] Fetching Ollama model info from ${backendUrl}${OLLAMA_ENDPOINTS.SHOW}`);

    try {
      const response = await axios.post<OllamaModelInfo>(
        `${backendUrl}${OLLAMA_ENDPOINTS.SHOW}`,
        { name: modelName },
        {
          headers: authHeader ? { 'Authorization': authHeader } : {},
          timeout: 30000,
        }
      );

      logger.debug(`[ModelFetcher] Fetched info for model: ${modelName}`);
      return response.data;
    } catch (error) {
      logger.error(`[ModelFetcher] Failed to fetch Ollama model info:`, error);
      throw new Error(`Failed to fetch model info from Ollama backend: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export const modelFetcher = new ModelFetcher();
