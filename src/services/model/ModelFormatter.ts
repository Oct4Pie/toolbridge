/**
 * Model Formatter
 *
 * Formats universal models into OpenAI and Ollama response formats.
 * Handles creation of Ollama model info with templates and parameters.
 */

import { modelConverter } from '../../translation/converters/modelConverter.js';
import { configService } from '../configService.js';

import { licenseProvider } from './LicenseProvider.js';

import type {
  OpenAIModelsResponse,
  OllamaModelsResponse,
  OllamaModelInfo,
  UniversalModel,
} from '../../translation/types/models.js';

// Tool-aware Ollama template for XML-based tool calling
const TOOL_AWARE_TEMPLATE = `{{- $lastUserIdx := -1 -}}
{{- range $idx, $msg := .Messages -}}
{{- if eq $msg.Role "user" }}{{ $lastUserIdx = $idx }}{{ end -}}
{{- end }}
{{- if or .System .Tools }}<|im_start|>system
{{ if .System }}
{{ .System }}
{{- end }}
{{- if .Tools }}

# Tools

You may call one or more functions to assist with the user query.

You are provided with function signatures within <tools></tools> XML tags:
<tools>
{{- range .Tools }}
{"type": "function", "function": {{ .Function }}}
{{- end }}
</tools>

For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:
<tool_call>
{"name": <function-name>, "arguments": <args-json-object>}
</tool_call>
{{- end -}}
<|im_end|>
{{ end }}
{{- range $i, $_ := .Messages }}
{{- $last := eq (len (slice $.Messages $i)) 1 -}}
{{- if eq .Role "user" }}<|im_start|>user
{{ .Content }}
{{- if and $.IsThinkSet (eq $i $lastUserIdx) }}
   {{- if $.Think -}}
      {{- " "}}/think
   {{- else -}}
      {{- " "}}/no_think
   {{- end -}}
{{- end }}<|im_end|>
{{ else if eq .Role "assistant" }}<|im_start|>assistant
{{ if (and $.IsThinkSet (and .Thinking (or $last (gt $i $lastUserIdx)))) -}}
<think>{{ .Thinking }}</think>
{{ end -}}
{{ if .Content }}{{ .Content }}
{{- else if .ToolCalls }}<tool_call>
{{ range .ToolCalls }}{"name": "{{ .Function.Name }}", "arguments": {{ .Function.Arguments }}}
{{ end }}</tool_call>
{{- end }}{{ if not $last }}<|im_end|>
{{ end }}
{{- else if eq .Role "tool" }}<|im_start|>user
<tool_response>
{{ .Content }}
</tool_response><|im_end|>
{{ end }}
{{- if and (ne .Role "assistant") $last }}<|im_start|>assistant
{{ if and $.IsThinkSet (not $.Think) -}}
<think>

</think>

{{ end -}}
{{ end }}
{{- end }}`;

export class ModelFormatter {
  /**
   * Format universal models as OpenAI response
   */
  formatAsOpenAIResponse(models: UniversalModel[]): OpenAIModelsResponse {
    return {
      object: 'list',
      data: models.map(model => modelConverter.toOpenAI(model)),
    };
  }

  /**
   * Format universal models as Ollama response
   */
  formatAsOllamaResponse(models: UniversalModel[]): OllamaModelsResponse {
    return {
      models: models.map(model => modelConverter.toOllama(model)),
    };
  }

  /**
   * Create Ollama model info from universal model
   * Includes tool-aware template and full metadata
   */
  createOllamaModelInfo(model: UniversalModel): OllamaModelInfo {
    const ollamaModel = modelConverter.toOllama(model);
    const metadata = model.metadata ?? {};

    // Ensure families is an array
    const families = Array.isArray(ollamaModel.details.families) && ollamaModel.details.families.length > 0
      ? ollamaModel.details.families
      : [ollamaModel.details.family];

    // Get license text
    const licenseText = licenseProvider.getLicense(metadata);

    // Build parameters
    const parameterEntries: Array<[string, string]> = [
      ['temperature', this.formatParameterValue((metadata['temperature'] as number | undefined) ?? 0.7)],
      ['top_p', this.formatParameterValue((metadata['top_p'] as number | undefined) ?? 0.9)],
      ['top_k', this.formatParameterValue((metadata['top_k'] as number | undefined) ?? 40)],
      ['repeat_penalty', this.formatParameterValue((metadata['repeat_penalty'] as number | undefined) ?? 1)],
      ['stop', '"<|im_start|>"'],
      ['stop', '"<|im_end|>"'],
    ];

    const parametersString = parameterEntries
      .map(([key, value]) => `${key.padEnd(30)}${value}`)
      .join('\n');

    // Build modelfile
    const modelfile = [
      '# ToolBridge: Tool calling enabled via XML translation layer',
      `# Modelfile for ${model.name}`,
      `FROM ${model.id}`,
      '',
      'TEMPLATE """',
      TOOL_AWARE_TEMPLATE,
      '"""',
      '',
      ...parameterEntries.map(([key, value]) => `PARAMETER ${key} ${value}`),
      '',
      'LICENSE """',
      licenseText,
      '"""',
    ].join('\n');

    // Build capabilities list
    const capabilityList: string[] = [];
    if (model.capabilities.chat) {capabilityList.push('chat');}
    if (model.capabilities.completion) {capabilityList.push('completion');}
    // if (model.capabilities.tools) {capabilityList.push('tools');}
    if (model.capabilities.functionCalling) {capabilityList.push('function_calling');}
    if (model.capabilities.embedding) {capabilityList.push('embedding');}
    if (model.capabilities.vision) {capabilityList.push('vision');}
    capabilityList.push('tools')

    // Build model_info
    const modelInfo: Record<string, unknown> = {
      'general.architecture': ollamaModel.details.family,
      'general.type': 'model',
      'general.size_label': ollamaModel.details.parameter_size,
      'general.quantization_level': ollamaModel.details.quantization_level,
    };

    if (model.contextLength !== undefined) {
      modelInfo['general.context_length'] = model.contextLength;
    }

    if (model.description) {
      modelInfo['general.description'] = model.description;
    }

    // Add license info
    const licenseCandidate = Object.entries(metadata).find(([key, value]) =>
      key.toLowerCase().includes('license') && typeof value === 'string' && value.trim().length > 0,
    );
    if (licenseCandidate) {
      modelInfo['general.license'] = licenseCandidate[1];
    } else {
      modelInfo['general.license'] = 'unknown';
    }

    // Add OpenAI metadata if present
    const created = metadata['created'];
    if (typeof created === 'number') {
      modelInfo['openai.created'] = created;
    }

    const ownedBy = metadata['owned_by'];
    if (typeof ownedBy === 'string') {
      modelInfo['openai.owned_by'] = ownedBy;
    }

    if (model.pricing) {
      modelInfo['pricing'] = model.pricing;
    }

    // Add ToolBridge metadata
    modelInfo['toolbridge.capabilities'] = model.capabilities;
    modelInfo['toolbridge.backend_mode'] = configService.getBackendMode();

    const modifiedAt = (metadata['modified_at'] as string | undefined) ?? new Date().toISOString();

    return {
      license: licenseText,
      modelfile,
      parameters: parametersString,
      template: TOOL_AWARE_TEMPLATE,
      details: {
        ...ollamaModel.details,
        families,
      },
      model_info: modelInfo as any, // Type assertion needed: generated ModelInfo has specific Qwen3 fields
      tensors: [],
      capabilities: capabilityList,
      modified_at: modifiedAt,
    };
  }

  /**
   * Format parameter value for display
   */
  private formatParameterValue(value: string | number): string {
    if (typeof value === 'number') {
      return value.toString();
    }
    return value;
  }
}

export const modelFormatter = new ModelFormatter();
