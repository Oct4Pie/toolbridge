/**
 * Ollama /api/show Handler
 *
 * CRITICAL: This is a DETAIL endpoint - adds ToolBridge enhancements.
 * Returns detailed model info WITH capabilities array.
 *
 * Architecture Decision:
 * - /api/tags: Simple passthrough, no enhancements
 * - /api/show (this): Enhancement endpoint, adds capabilities to show what ToolBridge enables
 *
 * SSOT: Uses ModelConverter for capability determination
 */

import axios from 'axios';

import { logger } from '../logging/index.js';
import { configService } from '../services/configService.js';
import { modelConverter } from '../translation/converters/modelConverter.js';

import type { OllamaModelInfo, OllamaModel } from '../translation/types/models.js';
import type { Request, Response } from 'express';

/**
 * Handler for /api/show endpoint
 * Returns detailed model info WITH capabilities array
 */
export default async function ollamaShowHandler(req: Request, res: Response): Promise<void> {
  try {
    const backendUrl = configService.getOllamaBackendUrl();
    const authHeader = req.headers.authorization;

    logger.info(`[OLLAMA SHOW] Request body: ${JSON.stringify(req.body)}`);

    // Extract model name from request body
    interface ShowRequest {
      name?: string;
      model?: string; // Official SDK might use 'model' instead of 'name'
      [key: string]: unknown;
    }

    const showRequest = req.body as ShowRequest;
    const modelName = showRequest.name ?? showRequest.model;

    if (!modelName) {
      logger.error(`[OLLAMA SHOW] Missing model name in request body: ${JSON.stringify(req.body)}`);
      res.status(400).json({
        error: 'Bad Request',
        message: 'Model name is required',
      });
      return;
    }

    logger.debug(`[OLLAMA SHOW] Getting model info: model=${modelName}`);

    // Fetch model info from backend
    const backendResponse = await axios.post<OllamaModelInfo>(
      `${backendUrl}/api/show`,
      { name: modelName },
      {
        headers: authHeader ? { 'Authorization': authHeader } : {},
        timeout: 30000,
      }
    );

    const response = backendResponse.data;

    // CRITICAL: Add capabilities array to response
    // ToolBridge enables tool calling for ALL models via XML translation
    // Use modelConverter (SSOT) to determine capabilities
    if (response.details) {
      // Build a minimal OllamaModel from the response to pass through converter
      const ollamaModel: OllamaModel = {
        name: modelName,
        model: modelName,
        modified_at: response.modified_at ?? new Date().toISOString(),
        size: 0, // Not used for capability detection
        digest: '',
        details: response.details,
      };

      // Convert through universal format to get capabilities
      const universalModel = modelConverter.fromOllama(ollamaModel);
      const withCapabilities = modelConverter.toOllama(universalModel);

      // Add capabilities array to response (SSOT from modelConverter)
      response.capabilities = withCapabilities.capabilities ?? ['completion', 'tools'];

      logger.info(`[OLLAMA SHOW] Added capabilities for ${modelName}:`, response.capabilities);
    } else {
      // Fallback: If no details, assume chat model with tool support
      response.capabilities = ['completion', 'tools'];
      logger.warn(`[OLLAMA SHOW] No details for ${modelName}, using default capabilities`);
    }

    // Ensure tool support is advertised in template (ToolBridge enables tools for all models)
    if (typeof response.template === 'string') {
      const hasToolsSupport = response.template.includes('{{- if .Tools }}');

      if (!hasToolsSupport) {
        const toolSection = `{{- if .Tools }}
<|im_start|>system
You have access to the following tools:
{{- range .Tools }}
- {{ .Function.Name }}: {{ .Function.Description }}
{{- end }}

When calling tools, use this XML format:
<toolbridge:calls>
  <tool_name>
    <param>value</param>
  </tool_name>
</toolbridge:calls>
<|im_end|>
{{- end }}
`;
        response.template = toolSection + response.template;
        logger.debug(`[OLLAMA SHOW] Added tool support to template`);
      }
    }

    // Add ToolBridge note to modelfile
    if (typeof response.modelfile === 'string') {
      const toolNote = '# ToolBridge: Tool calling enabled via XML translation layer\n';
      if (!response.modelfile.includes('ToolBridge')) {
        response.modelfile = toolNote + response.modelfile;
      }
    }

    logger.debug(`[OLLAMA SHOW] Returning detailed model info with capabilities`);

    if (configService.isDebugMode()) {
      logger.debug(`[OLLAMA SHOW] Response content:`, JSON.stringify(response, null, 2));
    }

    // Send response with capabilities
    res.status(200).json(response);
  } catch (error) {
    logger.error('[OLLAMA SHOW] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('ECONNREFUSED')) {
      res.status(503).json({
        error: 'Service Unavailable',
        message: `Cannot connect to backend: ${errorMessage}`,
      });
    } else if (errorMessage.includes('not found')) {
      res.status(404).json({
        error: 'Not Found',
        message: errorMessage,
      });
    } else if (errorMessage.includes('Failed to fetch')) {
      res.status(502).json({
        error: 'Bad Gateway',
        message: errorMessage,
      });
    } else {
      res.status(500).json({
        error: 'Internal Server Error',
        message: errorMessage,
      });
    }
  }
}
