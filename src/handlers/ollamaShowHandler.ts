/**
 * Ollama /api/show Handler
 *
 * CRITICAL: Supports bidirectional translation based on backend mode
 * - If backend=Ollama: Fetch from Ollama and add ToolBridge capabilities
 * - If backend=OpenAI: Synthesize Ollama format response from OpenAI model
 *
 * This ensures ALL endpoints translate based on the configured backend mode.
 *
 * SSOT: Uses ModelConverter for capability determination and format translation
 */

import axios from 'axios';

import { OLLAMA_ENDPOINTS } from '../constants/endpoints.js';
import { APACHE_LICENSE_TEXT } from '../constants/licenses.js';
import { logger } from '../logging/index.js';
import { configService } from '../services/configService.js';
import { modelService } from '../services/index.js';
import { modelConverter } from '../translation/converters/modelConverter.js';
import { sendHTTPError, sendValidationError } from '../utils/http/errorResponseHandler.js';
import { extractAuthHeader, sendSuccessJSON } from '../utils/http/handlerUtils.js';

import type { OllamaModel } from '../translation/types/models.js';
import type { ShowResponse } from '../types/generated/ollama/show.js';
import type { Request, Response } from 'express';

/**
 * Handler for /api/show endpoint
 * Returns detailed model info WITH capabilities array
 */
export default async function ollamaShowHandler(req: Request, res: Response): Promise<void> {
  try {
    const backendMode = configService.getBackendMode();
    const authHeader = extractAuthHeader(req);

    logger.info(`[OLLAMA SHOW] Request body: ${JSON.stringify(req.body)} (backend mode: ${backendMode})`);

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
      sendValidationError(res, 'Model name is required', 'OLLAMA SHOW');
      return;
    }

    logger.debug(`[OLLAMA SHOW] Getting model info: model=${modelName}`);

    let response: ShowResponse;

    if (backendMode === 'openai') {
      // Backend is OpenAI → Synthesize Ollama format response
      logger.debug(`[OLLAMA SHOW] Synthesizing Ollama format response from OpenAI model`);

      // Fetch all models to find this one
      const universalModels = await modelService.getUniversalModels(authHeader);
      const targetModel = universalModels.find(m => m.id === modelName || m.name === modelName);

      if (!targetModel) {
        throw new Error(`Model not found: ${modelName}`);
      }

      // Convert to Ollama format
      const ollamaModel = modelConverter.toOllama(targetModel);

      // Synthesize detailed response using GENERATED TYPE (SSOT)
      response = {
        license: APACHE_LICENSE_TEXT,
        modelfile: `# Model: ${modelName}\n# ToolBridge: Tool calling enabled via XML translation layer\nFROM ${modelName}\nLICENSE """${APACHE_LICENSE_TEXT}"""`,
        parameters: `temperature 0.7\ntop_p 0.9\ntop_k 40`,
        template: `{{- if .Tools }}
<|im_start|>system
You have access to the following tools:
{{- range .Tools }}
- {{ .Function.Name }}: {{ .Function.Description }}
{{- end }}

When calling tools, use this XML format:
<toolbridge_calls>
  <tool_name>
    <param>value</param>
  </tool_name>
</toolbridge_calls>
<|im_end|>
{{- end }}
<|im_start|>user
{{ .Prompt }}<|im_end|>
<|im_start|>assistant
`,
        details: {
          parent_model: ollamaModel.details.parent_model,
          format: ollamaModel.details.format,
          family: ollamaModel.details.family,
          families: ollamaModel.details.families,
          parameter_size: ollamaModel.details.parameter_size,
          quantization_level: ollamaModel.details.quantization_level,
        },
        model_info: {} as ShowResponse['model_info'], // Empty for remote models (not available)
        tensors: [], // Empty for remote models (not available)
        capabilities: ollamaModel.capabilities ?? ['chat', 'completion', 'tools', 'function_calling'],
        modified_at: ollamaModel.modified_at,
      };

      logger.debug(`[OLLAMA SHOW] Synthesized Ollama format response for OpenAI model: ${modelName}`);
    } else {
      // Backend is Ollama → Fetch from backend
      const backendUrl = configService.getOllamaBackendUrl();

      const backendResponse = await axios.post<ShowResponse>(
        `${backendUrl}${OLLAMA_ENDPOINTS.SHOW}`,
        { name: modelName },
        {
          headers: authHeader ? { 'Authorization': authHeader } : {},
          timeout: 30000,
        }
      );

      response = backendResponse.data;

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
<toolbridge_calls>
  <tool_name>
    <param>value</param>
  </tool_name>
</toolbridge_calls>
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
    }

    logger.debug(`[OLLAMA SHOW] Returning detailed model info with capabilities`);

    // Send response with capabilities
    sendSuccessJSON(res, response, 'OLLAMA SHOW');
  } catch (error) {
    sendHTTPError(res, error, 'OLLAMA SHOW');
  }
}
