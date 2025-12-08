/**
 * Translation Tools Module
 * 
 * Prompt construction helpers and tool usage guidance.
 */

export {
  formatToolsForBackendPromptXML,
  buildXMLToolInstructionsFromGeneric,
  normalizeGenericTools,
  createToolReminderMessage,
  needsToolReinjection,
  estimateTokenCount,
} from './promptUtils.js';
