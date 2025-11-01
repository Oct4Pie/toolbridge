/**
 * XML Parser Module
 *
 * Centralizes XML parsing and tool call extraction logic.
 */

export {
  extractToolCallFromWrapper,
  hasToolCallWrapper,
  getWrapperTags,
} from './xmlToolParser.js';

export {
  extractToolCallXMLParser,
  attemptPartialToolCallExtraction,
} from './xmlUtils.js';
