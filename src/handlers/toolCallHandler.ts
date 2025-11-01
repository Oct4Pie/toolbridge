import { logger } from "../logging/index.js";

import type { ToolCallDetectionResult } from "../types/index.js";

export function detectPotentialToolCall(
  content: string | null | undefined,
  knownToolNames: string[] = []
): ToolCallDetectionResult {
  if (!content) {
    return {
      isPotential: false,
      isCompletedXml: false,
      rootTagName: null,
      confidence: 0,
      mightBeToolCall: false,
    };
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
    return {
      isPotential: false,
      isCompletedXml: false,
      rootTagName: null,
      confidence: 0,
      mightBeToolCall: false,
    };
  }

  const xmlStartIndex = contentToCheck.indexOf("<");
  const potentialXml = contentToCheck.substring(xmlStartIndex);

  const properXmlTagRegex =
    /<[a-zA-Z0-9_.-]+(?:(?:\s+[a-zA-Z0-9_.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^>\s]+))?)*\s*|\s*)(?:\/?>|$)/;
  const hasProperXmlTag = properXmlTagRegex.test(potentialXml);

  if (!hasProperXmlTag) {
    return {
      isPotential: false,
      isCompletedXml: false,
      rootTagName: null,
      confidence: 0,
      mightBeToolCall: false,
    };
  }

  let rootTagName: string | null = null;

  const rootTagMatch = potentialXml.match(
    /<(?:[a-zA-Z0-9_.-]+:)?([a-zA-Z0-9_.-]+(?:_[a-zA-Z0-9_.-]+)*)(?:[\s/>])/,
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

  const matchesKnownTool = exactMatchKnownTool;

  if (isCodeBlock) {
    logger.debug(
      `[TOOL DETECTOR] Content in code block - requiring exact match: ${matchesKnownTool}`,
    );
  } else {
    logger.debug(
      `[TOOL DETECTOR] Requiring exact tool name match: ${matchesKnownTool ? "matched" : "no match"}`,
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
  hasMatchingClosingTag = trimmed.includes(`</${rootTagName}>`);

  const isSelfClosing = potentialXml.includes("/>") && !hasMatchingClosingTag;

  // At this point, we know hasProperXmlTag && matchesKnownTool are true
  const isPotential = true;

  const isCompleteXml =
    hasMatchingClosingTag || isSelfClosing;

  // Calculate confidence score  
  let confidence = 0.5;
  confidence += 0.3; // exactMatchKnownTool is always true here
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
    `[TOOL DETECTOR] Has closing tag: ${hasMatchingClosingTag}, Self-closing: ${isSelfClosing}`,
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