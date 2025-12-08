import { logger } from "../../../logging/index.js";

import type { ToolCallDetectionResult } from "../../../types/index.js";

/**
 * Create negative detection result (no tool call detected)
 * Extracted to eliminate duplication (DRY principle)
 */
const createNegativeResult = (): ToolCallDetectionResult => ({
  isPotential: false,
  isCompletedXml: false,
  rootTagName: null,
  confidence: 0,
  mightBeToolCall: false,
});

/**
 * Detect if content potentially contains a tool call
 *
 * MOVED FROM HANDLER LAYER (src/handlers/toolCallHandler.ts)
 * Parsers should not depend on handlers - this is the correct location.
 *
 * @param content - Text content to analyze
 * @param knownToolNames - List of known tool names to match against
 * @returns Detection result with confidence score and metadata
 */
export function detectPotentialToolCall(
  content: string | null | undefined,
  knownToolNames: string[] = []
): ToolCallDetectionResult {
  if (!content) {
    return createNegativeResult();
  }

  const contentPreview =
    content.length > 200
      ? content.substring(0, 100) + "..." + content.substring(content.length - 100)
      : content;
  logger.debug(`[TOOL DETECTOR] Checking content (${content.length} chars): ${contentPreview}`);

  if (content.includes("ToolCalls")) {
    logger.debug("[TOOL DETECTOR] Found 'ToolCalls' marker in content");
  }

  const trimmed = content.trim();

  let contentToCheck = trimmed;
  let isCodeBlock = false;

  const codeBlockMatch = trimmed.match(/```(?:xml)[\s\n]?([\s\S]*?)[\s\n]?```/);

  // Use optional chaining to safely access captured group and check for XML
  const codeBlockContent = codeBlockMatch?.[1];
  if ((codeBlockContent?.includes("<")) ?? false) {
    contentToCheck = codeBlockContent ?? contentToCheck;
    isCodeBlock = true;
  }

  const hasOpeningAngle = contentToCheck.includes("<");
  if (!hasOpeningAngle) {
    return createNegativeResult();
  }

  // CRITICAL: Check for toolbridge:calls wrapper - this is ALWAYS a tool call container
  // Must check before checking individual tags, as wrapper contains tool calls inside
  const hasWrapperStart = contentToCheck.includes("<toolbridge:calls");
  const hasWrapperEnd = contentToCheck.includes("</toolbridge:calls>");
  
  // Also check for PARTIAL wrapper tag in streaming (e.g., "<tool", "<toolbr", "<toolbridge:")
  // Pattern covers all partial prefixes of "toolbridge:calls"
  const partialWrapperMatch = contentToCheck.match(/<(toolbridge:call|toolbridge:cal|toolbridge:ca|toolbridge:c|toolbridge:|toolbridge|toolbridg|toolbrid|toolbri|toolbr|toolb|tool)$/i);
  const isPartialWrapper = partialWrapperMatch !== null;
  
  if (hasWrapperStart || isPartialWrapper) {
    if (isPartialWrapper) {
      logger.debug(`[TOOL DETECTOR] Detected partial wrapper tag "<${partialWrapperMatch?.[1]}" - buffering`);
    } else {
      logger.debug("[TOOL DETECTOR] Detected <toolbridge:calls> wrapper - marking as potential tool call");
    }
    
    // Check if wrapper is complete
    const isWrapperComplete = hasWrapperEnd;
    
    // Try to find a known tool inside the wrapper
    let foundToolInWrapper: string | null = null;
    for (const toolName of knownToolNames) {
      if (contentToCheck.includes(`<${toolName}`)) {
        foundToolInWrapper = toolName;
        break;
      }
    }
    
    return {
      isPotential: true,
      isCompletedXml: isWrapperComplete,
      rootTagName: foundToolInWrapper ?? "toolbridge:calls",
      confidence: isWrapperComplete ? 0.9 : (isPartialWrapper ? 0.4 : 0.7),
      mightBeToolCall: true,
    };
  }

  // Warn if knownToolNames is empty but we see potential XML tool call patterns
  if (knownToolNames.length === 0) {
    // Check for common tool call wrapper patterns that suggest tools should have been passed
    const potentialToolCallPatterns = /<(?:tool_call|function_call|invoke|ToolCalls?)\b/i;
    if (potentialToolCallPatterns.test(contentToCheck)) {
      logger.warn(
        "[TOOL DETECTOR] Detected potential tool call XML pattern but knownToolNames is empty. " +
        "This may indicate tools were not passed correctly to the request. " +
        `Content preview: "${contentToCheck.substring(0, 100)}..."`
      );
    }
  }

  const xmlStartIndex = contentToCheck.indexOf("<");
  const potentialXml = contentToCheck.substring(xmlStartIndex);

  // Match opening tags (with or without attributes) that are properly formed
  // Allows: <search>, <search attr="val">, <search/>
  const properXmlTagRegex =
    /<[a-zA-Z0-9_.-]+(?:(?:\s+[a-zA-Z0-9_.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^>\s]+))?)*\s*|\s*)(?:\/?>)/;
  const hasProperXmlTag = properXmlTagRegex.test(potentialXml);

  if (!hasProperXmlTag) {
    // Check for incomplete tag that might be a tool call in streaming context
    // E.g., "<sea" or "<search" when "search" is a known tool
    const incompleteTagMatch = potentialXml.match(/^<([a-zA-Z0-9_.-]+)$/);
    if (incompleteTagMatch?.[1] && knownToolNames.length > 0) {
      const partialTagName = incompleteTagMatch[1];
      // Check if this partial tag could be a prefix of a known tool (min 3 chars to avoid false positives)
      if (partialTagName && partialTagName.length >= 3) {
        const matchedTool = knownToolNames.find(toolName =>
          toolName.toLowerCase().startsWith(partialTagName.toLowerCase())
        );
        if (matchedTool) {
          logger.debug(`[TOOL DETECTOR] Detected incomplete tag "<${partialTagName}" that matches known tool "${matchedTool}" - buffering`);
          return {
            isPotential: true,
            isCompletedXml: false,
            rootTagName: matchedTool, // Use full matched tool name, not partial
            confidence: 0.3,
            mightBeToolCall: true,
          };
        }
      }
    }
    return createNegativeResult();
  }

  let rootTagName: string | null = null;

  // Allow incomplete tags (e.g., "<sea" without closing ">") for streaming
  const rootTagMatch = potentialXml.match(
    /<(?:[a-zA-Z0-9_.-]+:)?([a-zA-Z0-9_.-]+(?:_[a-zA-Z0-9_.-]+)*)(?:[\s/>]|$)/,
  );

  if (rootTagMatch?.[1]) {
    rootTagName = rootTagMatch[1];

    const commonHtmlTags = [
      "div",
      "span",
      "p",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "table",
      "tr",
      "td",
      "th",
      "a",
      "img",
      "style",
      "script",
      "link",
      "meta",
      "title",
      "head",
      "body",
      "html",
      "form",
      "input",
      "button",
      "textarea",
      "select",
      "option",
    ] as const;

    if (commonHtmlTags.includes(rootTagName.toLowerCase() as typeof commonHtmlTags[number])) {
      logger.debug(
        `[TOOL DETECTOR] Detected common HTML tag "${rootTagName}" - immediately rejecting as tool call`,
      );
      return {
        isPotential: false,
        isCompletedXml: false,
        rootTagName: rootTagName,
        confidence: 0,
        mightBeToolCall: false,
      };
    }

    if (!knownToolNames.includes(rootTagName)) {
      logger.debug(
        `[TOOL DETECTOR] XML tag "${rootTagName}" is not a recognized tool name - ignoring as potential tool call`,
      );
    }
  } else {
    return {
      isPotential: false,
      isCompletedXml: false,
      rootTagName: null,
      confidence: 0,
      mightBeToolCall: false,
    };
  }

  const exactMatchKnownTool = knownToolNames.includes(rootTagName);

  // For streaming: allow prefix matches only if tag is at least 3 chars and incomplete
  // (e.g., "sea" matches "search", but not "s" or "se" to avoid false positives)
  const isIncomplete = !trimmed.includes(`</${rootTagName}>`) && !trimmed.includes('/>')
  const prefixMatchKnownTool = rootTagName.length >= 3 && isIncomplete && knownToolNames.some(toolName =>
    toolName.toLowerCase().startsWith(rootTagName.toLowerCase())
  );

  const matchesKnownTool = exactMatchKnownTool || prefixMatchKnownTool;

  if (isCodeBlock) {
    logger.debug(
      `[TOOL DETECTOR] Content in code block - requiring exact match: ${exactMatchKnownTool}`,
    );
  } else {
    logger.debug(
      `[TOOL DETECTOR] Tool name match: exact=${exactMatchKnownTool}, prefix=${prefixMatchKnownTool}`,
    );
  }

  if (!matchesKnownTool) {
    return {
      isPotential: false,
      isCompletedXml: false,
      rootTagName: rootTagName,
      confidence: 0,
      mightBeToolCall: false,
    };
  }

  let hasMatchingClosingTag = false;
  let hasIncompleteClosingTag = false;

  // If exact match, check for exact closing tag
  // If prefix match, check for any matching tool's closing tag
  if (exactMatchKnownTool) {
    hasMatchingClosingTag = trimmed.includes(`</${rootTagName}>`);
    // Also check for incomplete closing tag (missing final '>') - streaming edge case
    if (!hasMatchingClosingTag) {
      // Check if content ends with </tagname (without >)
      const incompletePattern = new RegExp(`</${rootTagName}\\s*$`, 'i');
      hasIncompleteClosingTag = incompletePattern.test(trimmed);
    }
  } else if (prefixMatchKnownTool) {
    // Check if any known tool that matches the prefix has a closing tag
    hasMatchingClosingTag = knownToolNames.some(toolName => {
      if (toolName.toLowerCase().startsWith(rootTagName.toLowerCase())) {
        return trimmed.includes(`</${toolName}>`);
      }
      return false;
    });
    // Also check for incomplete closing tags
    if (!hasMatchingClosingTag) {
      hasIncompleteClosingTag = knownToolNames.some(toolName => {
        if (toolName.toLowerCase().startsWith(rootTagName.toLowerCase())) {
          const incompletePattern = new RegExp(`</${toolName}\\s*$`, 'i');
          return incompletePattern.test(trimmed);
        }
        return false;
      });
    }
  }

  const isSelfClosing = potentialXml.includes("/>") && !hasMatchingClosingTag;

  // At this point, we know hasProperXmlTag && matchesKnownTool are true
  const isPotential = true;

  // Consider complete if we have a full closing tag, incomplete closing tag at end, or self-closing
  const isCompleteXml =
    hasMatchingClosingTag || hasIncompleteClosingTag || isSelfClosing;

  // Calculate confidence score
  let confidence = 0.5;
  if (exactMatchKnownTool) {
    confidence += 0.3;
  } else if (prefixMatchKnownTool) {
    confidence += 0.1; // Lower confidence for prefix matches
  }
  if (isCompleteXml) {confidence += 0.2;}

  logger.debug(
    `[TOOL DETECTOR] Content sample: "${trimmed.substring(0, 50)}..." (${
      trimmed.length
    } chars)`,
  );
  logger.debug(
    `[TOOL DETECTOR] Root tag: "${
rootTagName
    }", Matches known tool: ${matchesKnownTool}, In code block: ${isCodeBlock}`,
  );
  logger.debug(
    `[TOOL DETECTOR] Has closing tag: ${hasMatchingClosingTag}, Incomplete closing: ${hasIncompleteClosingTag}, Self-closing: ${isSelfClosing}`,
  );
  logger.debug(
    `[TOOL DETECTOR] Is potential: ${isPotential}, Is complete: ${isCompleteXml}`,
  );

  return {
    isPotential: isPotential,
    isCompletedXml: isCompleteXml,
    rootTagName: rootTagName,
    confidence: confidence,
    mightBeToolCall: isPotential,
  };
}
