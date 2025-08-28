import { detectPotentialToolCall } from "../handlers/toolCallHandler.js";

import logger from "./logger.js";

import type { 
  ExtractedToolCall,
  ToolCallDetectionResult,
  PartialExtractionResult,
  PartialToolCallState
} from "../types/index.js";

export function extractToolCallXMLParser(
  text: string | null | undefined, 
  knownToolNames: string[] = []
): ExtractedToolCall | null {
  if (!text || typeof text !== "string") {
    logger.debug("[XML Parser] Empty or invalid input text.");
    return null;
  }

  logger.debug(
    `[XML Parser] Attempting to extract tool call from text (length: ${text.length})`,
  );

  let processedText = text;

  const codeBlockRegex = /```(?:xml|markup|)[\s\n]?([\s\S]*?)[\s\n]?```/i;
  const codeBlockMatch = codeBlockRegex.exec(text);
  if (codeBlockMatch?.[1]) {
    processedText = codeBlockMatch[1];
    logger.debug("[XML Parser] Extracted content from XML code block.");
  }

  const xmlCommentRegex = /<!--\s*([\s\S]*?)\s*-->/;
  const xmlCommentMatch = xmlCommentRegex.exec(processedText);
  const commentContent = xmlCommentMatch?.[1]?.trim();
  if (commentContent && commentContent.startsWith("<") && commentContent.endsWith(">")) {
    processedText = commentContent;
    logger.debug("[XML Parser] Extracted content from XML comment.");
  }

  const firstTagIndex = processedText.indexOf("<");
  if (firstTagIndex > 0) {
    const removed = processedText.substring(0, firstTagIndex);
    processedText = processedText.substring(firstTagIndex);
    logger.debug(
      `[XML Parser] Removed leading non-XML content: "${removed.substring(0, 30)}..."`,
    );
  } else if (firstTagIndex === -1) {
    logger.debug("[XML Parser] No '<' character found. Not XML.");
    return null;
  }

  const trimmedText = processedText.trim();
  if (!trimmedText.startsWith("<") || !trimmedText.endsWith(">")) {
    logger.debug(
      "[XML Parser] Text does not appear to be enclosed in XML tags after preprocessing.",
    );

  if (knownToolNames.length > 0) {
      const toolRegexPattern = knownToolNames
        .map((name) => `<\\s*${name}[\\s\\S]*?<\\/${name}>`)
        .join("|");
      const toolFindRegex = new RegExp(`(${toolRegexPattern})`, "i");
      const potentialToolMatch = processedText.match(toolFindRegex);

      if (potentialToolMatch?.[0]) {
        const extractedTool = potentialToolMatch[0];
        logger.debug(
          "[XML Parser] Extracted potential tool call from mixed content",
        );
        processedText = extractedTool;
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  const rootElementMatch = trimmedText.match(/^<\s*([a-zA-Z0-9_.-]+)/);
  if (!rootElementMatch?.[1]) {
    logger.debug(
      `[XML Parser] Could not extract root element name from: ${trimmedText.substring(0, 50)}...`,
    );
    return null;
  }
  const rootElementName = rootElementMatch[1];

  const isKnownTool = knownToolNames.length > 0 && knownToolNames.some((tool) => tool.toLowerCase() === rootElementName.toLowerCase());
  if (!isKnownTool) {
    logger.debug(
      `[XML Parser] Root element '${rootElementName}' is not in knownToolNames list, ignoring.`,
    );
    return null;
  }

  logger.debug(
    `[XML Parser] Root element: '${rootElementName}'. Using REGEX strategy for known tool.`,
  );

  try {
    const toolFindRegex = new RegExp(
      `<\\s*${rootElementName}[\\s\\S]*?<\\/${rootElementName}>`,
      "i",
    );
    const potentialToolMatch = trimmedText.match(toolFindRegex);
    const textToProcess = potentialToolMatch
      ? potentialToolMatch[0]
      : trimmedText;

    const rootContentRegex = new RegExp(
      `<\\s*${rootElementName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${rootElementName}>\\s*$`,
      "i",
    );
    let rootContentMatch = rootContentRegex.exec(textToProcess);

    if (typeof rootContentMatch?.[1] === "undefined") {
      logger.warn(
        `[XML Parser] Regex failed to find content within <${rootElementName}>...</${rootElementName}> tags.`,
      );

      if (!trimmedText.includes(`</${rootElementName}>`)) {
        const fixedText = `${trimmedText}</${rootElementName}>`;
        const fixedMatch = rootContentRegex.exec(fixedText);
        if (typeof fixedMatch?.[1] !== "undefined") {
          logger.debug(
            `[XML Parser] Added missing closing tag </${rootElementName}> and re-matched.`,
          );
          rootContentMatch = fixedMatch;
        } else {
          logger.error(
            `[XML Parser] Missing closing tag </${rootElementName}> - cannot reliably fix it.`,
          );
          return null;
        }
      } else {
        logger.error(
          `[XML Parser] Could not extract content for tool '${rootElementName}', structure might be invalid.`,
        );
        return null;
      }
    }

    const rootContent = rootContentMatch[1];
    const finalArgs: Record<string, unknown> = {};

    const paramPattern = /<([a-zA-Z0-9_.-]+)>([\s\S]*?)<\/\1>/g;
    let paramMatch;

    while ((paramMatch = paramPattern.exec(rootContent)) !== null) {
      const paramName = paramMatch[1];
      let paramValue: string | number | boolean = paramMatch[2];

      const lowerVal = String(paramValue).toLowerCase();
      if (lowerVal === "true") {
        paramValue = true;
      } else if (lowerVal === "false") {
        paramValue = false;
      } else if (!isNaN(Number(paramValue)) && String(paramValue).trim() !== "") {
        paramValue = Number(paramValue);
      }

      finalArgs[paramName] = paramValue;
    }

    logger.debug(
      `[XML Parser] Successfully extracted parameters via regex for '${rootElementName}': ${Object.keys(finalArgs).join(", ")}`,
    );
    return { name: rootElementName, arguments: finalArgs };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(
      `[XML Parser] Error during REGEX parsing for tool '${rootElementName}':`,
      errorMessage,
    );
    return null;
  }
}

export function attemptPartialToolCallExtraction(
  content: string,
  knownToolNames: string[] = [],
  _previousState: PartialToolCallState | null = null,
): PartialExtractionResult {
  const MAX_BUFFER_SIZE = 10 * 1024;

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
  ];

  const htmlStartRegex = new RegExp(`^\\s*<(${commonHtmlTags.join("|")})\\b`);
  const htmlMatch = content.match(htmlStartRegex);

  if (htmlMatch) {
    const htmlTag = htmlMatch[1];
    logger.debug(
      `[XML Parser] Content starts with common HTML tag "${htmlTag}" - skipping extraction`,
    );

    if (_previousState?.mightBeToolCall === true) {
      logger.debug(
        `[XML Parser] Previously buffered content is now confirmed to be HTML. Resetting buffer.`,
      );
    }

    for (const toolName of knownToolNames) {
      const toolStartIndex = content.indexOf(`<${toolName}`);
      if (toolStartIndex > 0) {
        const closingTagPattern = new RegExp(`</${toolName}>`, "i");
        const closingMatch = content.match(closingTagPattern);

        if (closingMatch?.index !== undefined && closingMatch.index > toolStartIndex) {
          const endIndex = closingMatch.index + closingMatch[0].length;
          const toolCallContent = content.substring(toolStartIndex, endIndex);

          const extracted = extractToolCallXMLParser(
            toolCallContent,
            knownToolNames,
          );

          if (
            extracted &&
            extracted.name.toLowerCase() === toolName.toLowerCase()
          ) {
            logger.debug(
              `[XML Parser] Found tool call '${toolName}' after HTML content`,
            );
            return {
              complete: true,
              toolCall: extracted,
              content: toolCallContent,
            };
          }
        }
      }
    }

    return {
      complete: false,
      partialState: {
        rootTag: null,
        isPotential: false,
        mightBeToolCall: false,
        buffer: "",
        identifiedToolName: null,
      },
    };
  }

  if (content.length > MAX_BUFFER_SIZE) {
    logger.debug(
      `[XML Parser] Buffer size (${content.length} chars) exceeds maximum (${MAX_BUFFER_SIZE}). Resetting buffer.`,
    );

    const lastPart = content.substring(content.length - MAX_BUFFER_SIZE);
    const prelimDetection: ToolCallDetectionResult = detectPotentialToolCall(lastPart, knownToolNames);

    if (!prelimDetection.mightBeToolCall) {
      return {
        complete: false,
        partialState: {
          rootTag: null,
          isPotential: false,
          mightBeToolCall: false,
          buffer: "",
          identifiedToolName: null,
        },
      };
    }

    content = lastPart;
  }

  const detection: ToolCallDetectionResult = detectPotentialToolCall(content, knownToolNames);

  if (detection.rootTagName && !detection.mightBeToolCall) {
    logger.debug(
      `[XML Parser] Tag "${detection.rootTagName}" confirmed not to be a tool call. Not buffering content.`,
    );

    return {
      complete: false,
      partialState: {
        rootTag: null,
        isPotential: false,
        mightBeToolCall: false,
        buffer: "",
        identifiedToolName: null,
      },
    };
  }

  if (
    _previousState &&
    _previousState.mightBeToolCall &&
    !detection.mightBeToolCall
  ) {
    logger.debug(
      `[XML Parser] Previously buffered content is now confirmed not to be a tool call. Resetting buffer.`,
    );

    return {
      complete: false,
      partialState: {
        rootTag: null,
        isPotential: false,
        mightBeToolCall: false,
        buffer: "",
        identifiedToolName: null,
      },
    };
  }

  if (detection.mightBeToolCall) {
    try {
      if (detection.isCompletedXml) {
        const extracted = extractToolCallXMLParser(content, knownToolNames);
        if (extracted) {
          return {
            complete: true,
            toolCall: extracted,
            content: content,
          };
        }
      }

      if (detection.rootTagName) {
        for (const toolName of knownToolNames) {
          if (toolName.toLowerCase() === detection.rootTagName.toLowerCase()) {
            const tagRegex = new RegExp(
              `<${toolName}[^>]*?>([\\s\\S]*?)<\\/${toolName}>`,
              "gi",
            );
            let match;

            while ((match = tagRegex.exec(content)) !== null) {
              const potentialTool = match[0];
              const extracted = extractToolCallXMLParser(
                potentialTool,
                knownToolNames,
              );

              if (
                extracted &&
                extracted.name.toLowerCase() === toolName.toLowerCase()
              ) {
                logger.debug(
                  `[XML Parser] Found embedded tool call for '${toolName}'`,
                );
                return {
                  complete: true,
                  toolCall: extracted,
                  content: potentialTool,
                };
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.debug("[XML Parser] Error during tool call extraction:", errorMessage);
    }
  }

  if (
    _previousState &&
    _previousState.mightBeToolCall &&
    !detection.mightBeToolCall &&
    detection.rootTagName
  ) {
    logger.debug(
      `[XML Parser] Previously buffered content is now confirmed not to be a tool call. Resetting buffer.`,
    );

    return {
      complete: false,
      partialState: {
        rootTag: null,
        isPotential: false,
        mightBeToolCall: false,
        buffer: "",
        identifiedToolName: null,
      },
    };
  }

  return {
    complete: false,
    partialState: {
      rootTag: detection.rootTagName,
      isPotential: detection.isPotential,
      mightBeToolCall: detection.mightBeToolCall,
      buffer: detection.mightBeToolCall ? content : "",
      identifiedToolName:
        detection.rootTagName ??
        _previousState?.identifiedToolName ?? null,
    },
  };
}