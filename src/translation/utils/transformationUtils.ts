/**
 * Transformation Utilities
 *
 * Helper functions for applying transformations to generic requests
 * when target providers don't support certain features.
 */

import { buildXMLToolInstructionsFromGeneric } from '../tools/index.js';

import type {
  GenericLLMRequest,
  CompatibilityResult,
  ConversionContext,
  GenericToolChoice,
} from '../types/index.js';

// Helper functions defined before use to avoid no-use-before-define lint errors

function stripNativeToolFields(
  request: GenericLLMRequest,
  toolChoice: GenericToolChoice | undefined,
  context: ConversionContext,
  logStep: (context: ConversionContext, step: string, description: string) => void
): GenericLLMRequest {
  const sanitized: GenericLLMRequest = { ...request };

  if (sanitized.tools) {
    delete (sanitized as unknown as Record<string, unknown>)['tools'];
  }

  if (sanitized.toolChoice !== undefined) {
    delete (sanitized as unknown as Record<string, unknown>)['toolChoice'];
  }

  if (sanitized.parallelToolCalls !== undefined) {
    delete (sanitized as unknown as Record<string, unknown>)['parallelToolCalls'];
  }

  const openaiExtensions = sanitized.extensions?.openai;
  if (openaiExtensions && typeof openaiExtensions === 'object') {
    const clone = { ...openaiExtensions } as Record<string, unknown>;
    if ('functionCall' in clone) {
      delete clone['functionCall'];
    }

    sanitized.extensions = {
      ...sanitized.extensions,
      openai: clone,
    };
  }

  logStep(
    context,
    'strip_native_tools',
    toolChoice === 'none'
      ? 'Removed native tool metadata (toolChoice=none) to honor passTools=false'
      : 'Removed native tool metadata due to passTools=false configuration',
  );

  return sanitized;
}

function buildToolChoiceDirective(toolChoice: GenericToolChoice | undefined): string {
  if (!toolChoice || toolChoice === 'auto') {
    return '';
  }

  if (toolChoice === 'required') {
    return '\nYou MUST decide on the most appropriate tool from the list above and emit a valid XML tool call before providing any final answer.';
  }

  if (typeof toolChoice === 'object' && toolChoice.type === 'function' && toolChoice.function?.name) {
    return `\nYou MUST call the tool named "${toolChoice.function.name}" using the XML format described above before finalizing your response.`;
  }

  return '';
}

/**
 * Convert tools to instruction text for providers that don't support native tool calling
 */
function convertToolsToInstructions(tools: unknown[]): string {
  type ToolType = { function: { name: string; description?: string; parameters?: unknown } };
  const instructions = tools.map(tool => {
    const func = (tool as ToolType).function;
    return `Function: ${func.name}\nDescription: ${func.description ?? 'No description'}\nParameters: ${JSON.stringify(func.parameters ?? {})}`;
  }).join('\n\n');

  return `You have access to the following functions. When you need to use a function, respond with a JSON object containing the function name and parameters:\n\n${instructions}\n\nTo use a function, respond with: {"function": "function_name", "parameters": {...}}`;
}

/**
 * Apply transformations for unsupported features
 */
export function applyTransformations(
  request: GenericLLMRequest,
  compatibility: CompatibilityResult,
  context: ConversionContext,
  logStep: (context: ConversionContext, step: string, description: string) => void
): GenericLLMRequest {
  let transformed: GenericLLMRequest = { ...request };

  if (context.passTools !== true) {
    const tools = Array.isArray(transformed.tools) ? transformed.tools : [];
    const toolChoice = transformed.toolChoice;
    const hasTools = tools.length > 0;

    if (hasTools || toolChoice === 'none') {
      const messages = [...transformed.messages];
      let instructionsBlock = '';

      if (hasTools && toolChoice !== 'none') {
        const primaryInstructions = buildXMLToolInstructionsFromGeneric(tools);

        if (primaryInstructions.trim().length > 0) {
          const exclusiveNotice = '\nIMPORTANT: The tools listed above are the ONLY tools you may use. Only return XML tool calls when you genuinely need tool assistance.';
          const choiceDirective = buildToolChoiceDirective(toolChoice);
          instructionsBlock = `${primaryInstructions}${exclusiveNotice}${choiceDirective}`;

          const systemIndex = messages.findIndex((message) => message?.role === 'system');
          const hasInstructionsAlready = systemIndex !== -1
            && typeof messages[systemIndex]?.content === 'string'
            && (messages[systemIndex]?.content as string).includes('# TOOL USAGE INSTRUCTIONS');

          if (!hasInstructionsAlready) {
            if (systemIndex !== -1 && messages[systemIndex]) {
              const baseContent = typeof messages[systemIndex].content === 'string'
                ? messages[systemIndex].content as string
                : '';
              const updatedContent = baseContent.length > 0
                ? `${baseContent}\n\n---\n\n${instructionsBlock}`
                : instructionsBlock;

              messages[systemIndex] = {
                ...messages[systemIndex],
                content: updatedContent,
              };
            } else {
              messages.unshift({
                role: 'system',
                content: `You are a helpful AI assistant. When a tool is needed, emit only the XML described above. When no tool is required, respond normally.\n\n${instructionsBlock}`,
              });
            }

            logStep(context, 'inject_tool_instructions', 'Injected XML tool instructions into request messages');
          }
        }
      } else if (toolChoice === 'none') {
        const directive = 'Tool usage is disabled for this request. Provide your answer directly without calling any tools or emitting tool XML.';
        const systemIndex = messages.findIndex((message) => message?.role === 'system');

        if (systemIndex !== -1 && messages[systemIndex]) {
          const baseContent = typeof messages[systemIndex].content === 'string'
            ? messages[systemIndex].content as string
            : '';
          if (!baseContent.includes('Tool usage is disabled for this request')) {
            const updatedContent = baseContent.length > 0
              ? `${baseContent}\n\n---\n\n${directive}`
              : directive;
            messages[systemIndex] = {
              ...messages[systemIndex],
              content: updatedContent,
            };
            logStep(context, 'tool_usage_disabled', 'Added directive to avoid tool calls');
          }
        } else {
          messages.unshift({
            role: 'system',
            content: `You are a helpful AI assistant. ${directive}`,
          });
          logStep(context, 'tool_usage_disabled', 'Inserted system directive to avoid tool calls');
        }
      }

      transformed = {
        ...transformed,
        messages,
      };

      transformed = stripNativeToolFields(transformed, toolChoice, context, logStep);
    }
  }

  // Apply each transformation
  for (const transformation of compatibility.transformations) {
    switch (transformation.from) {
      case 'tool_calls':
        // Convert tool calls to system instructions
        if (transformed.tools) {
          const instructions = convertToolsToInstructions(transformed.tools);
          transformed.messages.unshift({
            role: 'system',
            content: instructions
          });
          delete (transformed as unknown as Record<string, unknown>)['tools']; // Remove tools property
          logStep(context, 'transform_tools', 'Converted tool calls to system instructions');
        }
        break;

      case 'n > 1':
        // Force single choice
        transformed.n = 1;
        logStep(context, 'transform_choices', 'Limited to single choice response');
        break;

      case 'structured_outputs':
        // Convert structured outputs to JSON mode
        if (typeof transformed.responseFormat === 'object') {
          const responseFormat = transformed.responseFormat as { json_schema?: { schema?: unknown } };
          transformed.responseFormat = 'json_object';
          // Add schema instruction to system message
          const schemaInstruction = `Return response as JSON matching this schema: ${JSON.stringify(responseFormat?.json_schema?.schema ?? {})}`;
          transformed.messages.unshift({
            role: 'system',
            content: schemaInstruction
          });
          logStep(context, 'transform_structured_output', 'Converted structured output to JSON mode with instructions');
        }
        break;
    }
  }

  return transformed;
}
