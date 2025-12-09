export type { ExtractedToolCall } from "../../types/index.js";

export {
  getWrapperTags,
  hasToolCallWrapper,
  extractToolCallFromWrapper,
  extractToolCallsFromWrapper,
  extractToolCall,
  attemptPartialToolCallExtraction,
} from "./toolCallParser.js";

export { detectPotentialToolCall } from "./utils/toolCallDetection.js";

// SSOT: Unified extraction functions - prefer these over wrapper-only or direct-only extraction
export {
  extractToolCallUnified,
  extractToolCallsUnified,
} from "./utils/unifiedToolExtraction.js";
