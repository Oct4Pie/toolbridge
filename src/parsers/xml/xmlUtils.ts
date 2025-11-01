import { detectPotentialToolCall } from "../../handlers/toolCallHandler.js";
import { logger } from "../../logging/index.js";

import type { 
  ExtractedToolCall,
  ToolCallDetectionResult,
  PartialExtractionResult,
  PartialToolCallState
} from "../../types/index.js";

// HTML entity decoding helper function
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
    '&nbsp;': ' ',
  };
  
  return text.replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g, (match) => entities[match] ?? match);
}

// ----------------------------
// Balanced-tag XML utilities
// ----------------------------

function getLocalName(qName: string): string {
  const idx = qName.lastIndexOf(":");
  return idx >= 0 ? qName.slice(idx + 1) : qName;
}

function isNameChar(ch: string): boolean {
  return /[A-Za-z0-9_.:-]/.test(ch);
}

function readUntil(text: string, i: number, terminator: string): number {
  const end = text.indexOf(terminator, i);
  return end >= 0 ? end + terminator.length : text.length;
}

function skipTagBody(text: string, i: number): number {
  // Skip until the next '>' accounting for quoted attribute values
  let inQuote: '"' | "'" | null = null;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === inQuote) {inQuote = null;}
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === '>') {return i + 1;}
  }
  return i;
}

type StartTag = {
  name: string;        // qualified name
  local: string;       // local (no prefix)
  start: number;       // index of '<'
  end: number;         // index after '>'
  selfClosing: boolean;
};

function parseStartTag(text: string, i: number): StartTag | null {
  // Assumes text[i] === '<'
  let j = i + 1;
  if (j >= text.length) {return null;}
  const next = text[j];
  // Not a start tag
  if (next === '/' || next === '!' || next === '?') {return null;}

  // Read tag name
  let name = '';
  while (j < text.length) {
    const char = text[j];
    if (char === undefined || !isNameChar(char)) {break;}
    name += char;
    j++;
  }
  if (!name) {return null;}

  // Skip attributes (to closing '>'), tracking quotes to detect self-closing
  let k = j;
  k = skipTagBody(text, k);
  const raw = text.slice(i, k);
  const selfClosing = /\/>\s*$/.test(raw);
  return { name, local: getLocalName(name), start: i, end: k, selfClosing };
}

function parseEndTag(text: string, i: number): { name: string; local: string; end: number } | null {
  // Assumes text[i] === '<' and text[i+1] === '/'
  let j = i + 2;
  let name = '';
  while (j < text.length) {
    const char = text[j];
    if (char === undefined || !isNameChar(char)) {break;}
    name += char;
    j++;
  }
  if (!name) {return null;}
  // Skip to '>'
  while (j < text.length && text[j] !== '>') {j++;}
  return { name, local: getLocalName(name), end: j < text.length ? j + 1 : j };
}

function findBalancedElement(text: string, wantLocalName: string, fromIndex = 0): { start: number; openEnd: number; closeStart: number; end: number } | null {
  // Search for the first matching start tag by local name and then balance depth
  let i = fromIndex;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {return null;}
    // Handle comments, CDATA, PIs
    if (text.startsWith('<!--', lt)) { i = readUntil(text, lt + 4, '-->'); continue; }
    if (text.startsWith('<![CDATA[', lt)) { i = readUntil(text, lt + 9, ']]>'); continue; }
    if (text.startsWith('<?', lt)) { i = readUntil(text, lt + 2, '?>'); continue; }

    // Start tag?
    const startTag = parseStartTag(text, lt);
    if (startTag) {
      if (startTag.local.toLowerCase() !== wantLocalName.toLowerCase()) {
        i = startTag.end;
        continue;
      }
      if (startTag.selfClosing) {
        return { start: startTag.start, openEnd: startTag.end, closeStart: startTag.end, end: startTag.end };
      }
      // Balance
      let depth = 1;
      let p = startTag.end;
      while (p < text.length) {
        const nextLt = text.indexOf('<', p);
        if (nextLt < 0) {break;}
        if (text.startsWith('<!--', nextLt)) { p = readUntil(text, nextLt + 4, '-->'); continue; }
        if (text.startsWith('<![CDATA[', nextLt)) { p = readUntil(text, nextLt + 9, ']]>'); continue; }
        if (text.startsWith('<?', nextLt)) { p = readUntil(text, nextLt + 2, '?>'); continue; }
        if (text[nextLt + 1] === '/') {
          const endTag = parseEndTag(text, nextLt);
          if (endTag && endTag.local.toLowerCase() === wantLocalName.toLowerCase()) {
            depth--;
            if (depth === 0) {
              return { start: startTag.start, openEnd: startTag.end, closeStart: nextLt, end: endTag.end };
            }
          }
          p = endTag ? endTag.end : nextLt + 2;
          continue;
        }
        const innerStart = parseStartTag(text, nextLt);
        if (innerStart) {
          if (!innerStart.selfClosing && innerStart.local.toLowerCase() === wantLocalName.toLowerCase()) {
            depth++;
          }
          p = innerStart.end;
          continue;
        }
        // Fallback safeguard
        p = nextLt + 1;
      }
      return null; // unbalanced
    }
    // Not a start tag - advance
    i = lt + 1;
  }
  return null;
}

function synthesizeRegionForUnbalancedElement(text: string, startTag: StartTag): { start: number; openEnd: number; closeStart: number; end: number } {
  const closePattern = new RegExp(`<\\s*/\\s*${startTag.name}\\s*>`, "i");
  const searchArea = text.slice(startTag.end);
  const match = closePattern.exec(searchArea);
  if (match) {
    const closeStart = startTag.end + match.index;
    const closeEnd = closeStart + match[0].length;
    return { start: startTag.start, openEnd: startTag.end, closeStart, end: closeEnd };
  }
  // No closing tag found; treat the rest of the document as the element content
  return { start: startTag.start, openEnd: startTag.end, closeStart: text.length, end: text.length };
}

type ChildNode = { name: string; local: string; content: string };

function extractTopLevelChildren(xml: string): { children: ChildNode[]; textRemainder: string } {
  const children: ChildNode[] = [];
  let i = 0;
  let textBuf = '';
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { textBuf += xml.slice(i); break; }
    // capture any preceding text (mixed content)
    if (lt > i) { textBuf += xml.slice(i, lt); }

    if (xml.startsWith('<!--', lt)) { i = readUntil(xml, lt + 4, '-->'); continue; }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = readUntil(xml, lt + 9, ']]>');
      // Keep CDATA section verbatim inside text buffer; child parsing happens only for element nodes
      textBuf += xml.slice(lt, end);
      i = end; continue;
    }
    if (xml.startsWith('<?', lt)) { i = readUntil(xml, lt + 2, '?>'); continue; }
    if (xml[lt + 1] === '/') {
      // closing tag at this level -> end of top-level scan for children
      break;
    }
    const start = parseStartTag(xml, lt);
    if (!start) { i = lt + 1; continue; }

    // Find balanced region for this child by its own local name
    if (start.selfClosing) {
      children.push({ name: start.name, local: start.local, content: '' });
      i = start.end;
      continue;
    }
    const region = findBalancedElement(xml, start.local, lt);
    if (!region) {
      // Treat malformed child as plain text and continue scanning for subsequent well-formed siblings
      textBuf += xml.slice(lt, start.end);
      i = start.end;
      continue;
    }
    const inner = xml.slice(region.openEnd, region.closeStart);
    children.push({ name: start.name, local: start.local, content: inner });
    i = region.end;
  }
  return { children, textRemainder: textBuf };
}

function decodeCdataAndEntities(text: string): string {
  // Replace all CDATA sections with their inner content
  let out = text.replace(/<!\[CDATA\[([\s\S]*?)]]>/g, (_, inner) => inner);
  out = decodeHtmlEntities(out);
  return out;
}

function coercePrimitiveValue(raw: string): unknown {
  const decoded = decodeCdataAndEntities(raw);
  const trimmed = decoded.trim();
  if (trimmed === "") {
    return decoded;
  }
  const lower = trimmed.toLowerCase();
  if (lower === "true") {
    return true;
  }
  if (lower === "false") {
    return false;
  }
  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric) && trimmed === String(numeric)) {
    return numeric;
  }
  return decoded;
}

function mergeTextIntoObject(target: Record<string, unknown>, text: string): void {
  const decoded = decodeCdataAndEntities(text);
  if (decoded.trim().length === 0) {
    return;
  }
  const existing = target["_text"];
  if (typeof existing === "string") {
    target["_text"] = `${existing}${decoded}`;
  } else {
    target["_text"] = decoded;
  }
}

interface BuildOptions {
  rawToolNames?: Set<string>;
  rootToolName?: string;
}

function buildArgumentsFromXml(xml: string, options: BuildOptions = {}): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const { children, textRemainder } = extractTopLevelChildren(xml);

  // Mixed content outside of child tags (rare for tool calls). Preserve if non-empty.
  if (textRemainder && textRemainder.trim().length > 0 && !textRemainder.includes("<")) {
    const decoded = decodeCdataAndEntities(textRemainder);
    if (decoded.trim().length > 0) {args['_text'] = decoded;}
  }

  for (const child of children) {
    const localName = child.local.toLowerCase();
    // Parameters that should be treated as raw text payloads even if they contain markup
    const isRawParam = ["code", "html", "markdown", "md", "body", "content"].includes(localName);
    const isRawTool = options.rawToolNames?.has(localName) === true;
    const shouldPreserveForThink =
      options.rootToolName === "think" && (localName === "points" || localName === "thoughts");

    // Decide if this child has nested element children
    const nested = extractTopLevelChildren(child.content);
    const hasElementChildren = nested.children.length > 0;
    let value: unknown;

    if (isRawParam) {
      value = decodeCdataAndEntities(child.content);
    } else if (isRawTool || shouldPreserveForThink) {
      value = child.content;
    } else if (hasElementChildren) {
      let nestedArgs = buildArgumentsFromXml(child.content, options);
      if (nested.textRemainder && nested.textRemainder.trim().length > 0 && !nested.textRemainder.includes("<")) {
        mergeTextIntoObject(nestedArgs, nested.textRemainder);
      }
      const nestedKeys = Object.keys(nestedArgs);
      if (nestedKeys.length === 1 && nestedKeys[0] === "item" && Array.isArray(nestedArgs['item'])) {
        value = nestedArgs['item'];
      } else {
        value = nestedArgs;
      }
    } else if (child.content.includes("<![CDATA[")) {
      value = localName === "notes" ? decodeCdataAndEntities(child.content) : child.content;
    } else if (child.content.includes("<")) {
      // Contains markup but not parsed as separate children (e.g., malformed or intentional raw XML).
      value = decodeCdataAndEntities(child.content);
    } else {
      value = coercePrimitiveValue(child.content);
    }

    // Handle repeated keys -> array
    const key = child.local;
    if (key in args) {
      const existing = args[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        args[key] = [existing, value];
      }
    } else {
      args[key] = value;
    }
  }
  return args;
}

// Extract parameters from XML content with better nested structure handling
function extractParametersFromXMLContent(
  content: string,
  options: BuildOptions = {},
): Record<string, unknown> {
  return buildArgumentsFromXml(content, options);
}

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
  const knownToolSet: Set<string> = new Set(knownToolNames.map((name) => name.toLowerCase()));

  // Handle XML declarations
  if (processedText.includes('<?xml')) {
    processedText = processedText.replace(/<\?xml[^>]*\?>\s*/i, '');
    logger.debug("[XML Parser] Removed XML declaration.");
  }

  const codeBlockRegex = /```(?:xml|markup|)[\s\n]?([\s\S]*?)[\s\n]?```/i;
  const codeBlockMatch = codeBlockRegex.exec(processedText);
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

  // Handle JSON-wrapped XML - only if we have clear JSON structure
  if (processedText.includes('{"') && processedText.includes('"<') && processedText.includes('>"}')) {
    const jsonXmlMatch = processedText.match(/"([^"]*<[^"]*>[^"]*>)"/);
    if (jsonXmlMatch?.[1]) {
      processedText = jsonXmlMatch[1];
      logger.debug("[XML Parser] Extracted XML from JSON string.");
    }
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

  // Find the first known tool element and balance it
  let chosen: { name: string; local: string; region: { start: number; openEnd: number; closeStart: number; end: number } } | null = null;

  // If the document already starts with a tag, prefer that root if it matches
  if (trimmedText.startsWith("<")) {
    const rootStart = parseStartTag(trimmedText, 0);
    if (rootStart) {
      const local = rootStart.local.toLowerCase();
      const matchTool = knownToolNames.find((t) => t.toLowerCase() === local);
      if (matchTool) {
        const region = findBalancedElement(trimmedText, local, 0);
        const resolvedRegion = region ?? synthesizeRegionForUnbalancedElement(trimmedText, rootStart);
        if (resolvedRegion) {
          chosen = { name: matchTool, local, region: resolvedRegion };
        }
      }
    }
  }

  // Otherwise, or if root wasn't a known tool, search for the earliest occurrence of any tool tag
  if (!chosen) {
    let earliest: { idx: number; tool: string } | null = null;
    for (const t of knownToolNames) {
      const re = new RegExp(`<\\s*(?:[A-Za-z0-9_.-]+:)?${t}\\b`, 'i');
      const m = re.exec(trimmedText);
      if (m && (earliest === null || m.index < earliest.idx)) {
        earliest = { idx: m.index, tool: t };
      }
    }
    if (earliest) {
      const local = earliest.tool.toLowerCase();
      const startAtIdx = parseStartTag(trimmedText, earliest.idx);
      if (!startAtIdx || startAtIdx.local.toLowerCase() !== local) {
        logger.debug("[XML Parser] Unable to parse start tag for candidate tool.");
      } else {
        const region = findBalancedElement(trimmedText, local, earliest.idx);
        const resolvedRegion = region ?? synthesizeRegionForUnbalancedElement(trimmedText, startAtIdx);
        if (resolvedRegion) {chosen = { name: earliest.tool, local, region: resolvedRegion };}
      }
    }
  }

  if (!chosen) {
    logger.debug("[XML Parser] No matching tool element found after scanning.");
    return null;
  }

  const inner = trimmedText.slice(chosen.region.openEnd, chosen.region.closeStart);
  const finalArgs = extractParametersFromXMLContent(inner, {
    rawToolNames: knownToolSet,
    rootToolName: chosen.local,
  });
  logger.debug(
    `[XML Parser] Successfully extracted parameters for '${chosen.name}': ${Object.keys(finalArgs).join(', ')}`,
  );
  return { name: chosen.name, arguments: finalArgs };
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
