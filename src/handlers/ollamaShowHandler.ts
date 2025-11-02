/**
 * Ollama /api/show Handler
 *
 * Intercepts /api/show responses to ensure tool support is always advertised.
 * This is critical because the proxy's XML-based tool calling makes ANY model
 * tool-capable, but clients check /api/show to see if tools are supported.
 */

import axios from 'axios';

import { BACKEND_LLM_BASE_URL } from '../config.js';
import { logger } from '../logging/index.js';

import type { Request, Response } from 'express';

interface OllamaShowResponse {
  modelfile?: string;
  parameters?: string;
  template?: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
  model_info?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Handler for /api/show endpoint
 * Ensures the response always indicates tool support
 */
export default async function ollamaShowHandler(req: Request, res: Response): Promise<void> {
  try {
    const backendUrl = `${BACKEND_LLM_BASE_URL}/api/show`;

    logger.debug(`[OLLAMA SHOW] Proxying to: ${backendUrl}`);
    logger.debug(`[OLLAMA SHOW] Request body:`, JSON.stringify(req.body, null, 2));

    // Forward request to backend
    const response = await axios.post<OllamaShowResponse>(backendUrl, req.body, {
      headers: {
        'Content-Type': 'application/json',
      },
      validateStatus: () => true, // Accept any status code
    });

    logger.debug(`[OLLAMA SHOW] Backend response status: ${response.status}`);

    // If error response, just forward it
    if (response.status !== 200) {
      res.status(response.status).json(response.data);
      return;
    }

    // Modify response to ensure tool support is advertised
    const modifiedResponse = { ...response.data };

    // CRITICAL: Add "tools" to capabilities array
    // This is what clients actually check to determine tool support
    if (Array.isArray(modifiedResponse['capabilities'])) {
      if (!modifiedResponse['capabilities'].includes('tools')) {
        modifiedResponse['capabilities'].push('tools');
        logger.debug(`[OLLAMA SHOW] Added 'tools' to capabilities array`);
      }
    } else {
      modifiedResponse['capabilities'] = ['completion', 'tools'];
      logger.debug(`[OLLAMA SHOW] Created capabilities array with 'tools'`);
    }

    // Ensure template can handle tools (only modify if it doesn't already support them)
    if (typeof modifiedResponse.template === 'string') {
      const hasToolsSupport = modifiedResponse.template.includes('{{- if .Tools }}');

      if (!hasToolsSupport) {
        // Prepend tool handling WITHOUT breaking existing template
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
        modifiedResponse.template = toolSection + modifiedResponse.template;
        logger.debug(`[OLLAMA SHOW] Prepended tool support to template`);
      } else {
        logger.debug(`[OLLAMA SHOW] Template already has tool support, preserving it`);
      }
    }

    // Add a note in the modelfile comment if it exists
    if (typeof modifiedResponse.modelfile === 'string') {
      const toolNote = '# ToolBridge: Tool calling enabled via XML translation layer\n';
      if (!modifiedResponse.modelfile.includes('ToolBridge')) {
        modifiedResponse.modelfile = toolNote + modifiedResponse.modelfile;
      }
    }

    logger.debug(`[OLLAMA SHOW] Modified response to advertise tool support`);
    logger.debug(`[OLLAMA SHOW] Response content:`, JSON.stringify(modifiedResponse, null, 2));

    // Send modified response
    res.status(200).json(modifiedResponse);
  } catch (error) {
    logger.error('[OLLAMA SHOW] Error:', error);

    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        res.status(503).json({
          error: 'Service Unavailable',
          message: `Cannot connect to Ollama backend at ${BACKEND_LLM_BASE_URL}`,
        });
      } else if (error.response) {
        res.status(error.response.status).json(error.response.data);
      } else {
        res.status(502).json({
          error: 'Bad Gateway',
          message: error.message,
        });
      }
    } else {
      res.status(500).json({
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
