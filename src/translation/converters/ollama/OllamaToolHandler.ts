/**
 * Ollama Tool Handler
 *
 * Handles tool instruction injection and management for Ollama requests.
 * This is the SSOT for tool instruction logic, consolidating from payloadHandler.
 */

import {
  buildXMLToolInstructionsFromGeneric,
  normalizeGenericTools,
  createToolReminderMessage,
  needsToolReinjection,
} from '../../tools/index.js';
import { isToolsEmpty } from '../../utils/formatUtils.js';

import type { OllamaRequest } from '../../../types/ollama.js';
import type { OpenAIMessage } from '../../../types/openai.js';
import type { GenericTool, ConversionContext } from '../../types/index.js';

export class OllamaToolHandler {
  /**
   * Build tool instructions for XML format
   */
  buildToolInstructions(tools: GenericTool[]): string {
    if (isToolsEmpty(tools)) {
      return "";
    }

    return buildXMLToolInstructionsFromGeneric(tools);
  }

  /**
   * Inject tool instructions into the Ollama request messages.
   * This is the SSOT for tool instruction injection, consolidating logic from payloadHandler.
   */
  injectToolInstructions(
    ollamaRequest: Partial<OllamaRequest>,
    tools: GenericTool[],
    logTransformation: (ctx: ConversionContext, step: string, desc: string) => void,
    ctx: ConversionContext
  ): void {
    const toolInstructions = this.buildToolInstructions(tools);
    if (!toolInstructions) {
      return;
    }

    const exclusiveToolsNotice = `\nIMPORTANT: The tools listed above are the ONLY tools available to you. Do not attempt to use any other tools.`;
    const fullInstructions = `${toolInstructions}${exclusiveToolsNotice}`;

    const messages = ollamaRequest.messages ?? [];
    const systemMessageIndex = messages.findIndex((m) => m.role === 'system');

    if (systemMessageIndex !== -1) {
      const systemMessage = messages[systemMessageIndex];
      if (systemMessage) {
        const currentContent = String(systemMessage.content);

        // Avoid duplicating the heavy instruction block if it's already present
        const hasInstructionsAlready =
          currentContent.includes('# TOOL USAGE INSTRUCTIONS') ||
          currentContent.includes('<toolbridge_calls>');

        const reinjectionConfig = ctx.toolReinjection ?? {
          enabled: false,
          messageCount: 0,
          tokenCount: 0,
          type: 'system' as const,
        };

        if (
          reinjectionConfig.enabled &&
          needsToolReinjection(
            messages.map(msg => ({ role: msg.role, content: msg.content })) as OpenAIMessage[],
            reinjectionConfig.tokenCount,
            reinjectionConfig.messageCount,
          )
        ) {
          logTransformation(ctx, 'ollama_tool_reinjection', 'Tool reinjection enabled and needed');

          const instructionsToInject = createToolReminderMessage(normalizeGenericTools(tools));

          // Avoid redundant reinjections: if any of the last N messages already contain key hints, skip.
          const recentWindow = Math.max(messages.length - 6, 0);
          const alreadyReminded = messages.slice(recentWindow).some((m) => {
            const c = String(m.content);
            return c.includes('# TOOL USAGE INSTRUCTIONS') ||
              c.includes('<toolbridge_calls>') ||
              c.includes('Output raw XML only') ||
              c.includes('ONLY output raw XML');
          });

          if (!alreadyReminded) {
            // Honor reinjection role from config. If multiple system messages exist, prefer user role to avoid overriding base system.
            const systemCount = messages.filter((m) => m.role === 'system').length;
            const reinjectionRole: 'system' | 'user' = (reinjectionConfig.type === 'system' && systemCount <= 1)
              ? 'system'
              : 'user';

            const reinjectionIndex = reinjectionRole === 'system' ? systemMessageIndex + 1 : messages.length;

            messages.splice(reinjectionIndex, 0, {
              role: reinjectionRole,
              content: instructionsToInject,
            });

            logTransformation(ctx, 'ollama_tool_reinjection_done', `Reinjected tool instructions as ${reinjectionRole}`);
          } else {
            logTransformation(ctx, 'ollama_tool_reinjection_skip', 'Skipping reinjection: recent messages already contain tool reminder signals');
          }
        } else if (!hasInstructionsAlready) {
          systemMessage.content = `${currentContent}\n\n---\n\n${fullInstructions}`;
          logTransformation(ctx, 'ollama_tool_instructions_append', 'Appended XML tool instructions to existing system message');
        } else {
          logTransformation(ctx, 'ollama_tool_instructions_skip', 'Skipping tool instruction append; already present in system message');
        }
      }
    } else {
      messages.unshift({
        role: 'system',
        content: `You are a helpful AI assistant. Respond directly to the user's requests.\n\n${fullInstructions}\n\nWhen a specific tool is needed, use XML format as instructed above.`,
      });
      logTransformation(ctx, 'ollama_tool_instructions_new', 'Added system message with XML tool instructions');
    }

    ollamaRequest.messages = messages;
  }
}
