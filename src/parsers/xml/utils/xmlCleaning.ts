/**
 * XML text cleaning and preprocessing utilities
 * Extracted from toolCallParser.ts for KISS compliance
 */

/**
 * Decode common HTML entities in text
 */
export const decodeHtmlEntities = (text: string): string => {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&#39;": "'",
    "&nbsp;": " ",
  };
  return text.replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g, (match) => entities[match] ?? match);
};

/**
 * Extract CDATA content and decode HTML entities
 * Replaces CDATA sections with their inner content, then decodes entities
 */
export const decodeCdataAndEntities = (text: string): string => {
  // Replace all CDATA sections with their inner content
  let out = text.replace(/<!\[CDATA\[([\s\S]*?)]]>/g, (_, inner) => inner);
  out = decodeHtmlEntities(out);
  return out;
};

/**
 * Preprocess text for XML parsing
 * - Strips XML declarations
 * - Extracts XML from code blocks
 * - Handles XML in comments
 * - Handles JSON-wrapped XML
 * - Trims leading non-XML content
 */
export const preprocessForParsing = (text: string): string | null => {
  let processed = text;

  if (processed.includes('<?xml')) {
    processed = processed.replace(/<\?xml[^>]*\?>\s*/i, '');
  }

  const codeBlockRegex = /```(?:xml|markup|)[\s\n]?([\s\S]*?)[\s\n]?```/i;
  const codeBlockMatch = codeBlockRegex.exec(processed);
  if (codeBlockMatch?.[1]) {
    processed = codeBlockMatch[1];
  }

  const xmlCommentRegex = /<!--\s*([\s\S]*?)\s*-->/;
  const xmlCommentMatch = xmlCommentRegex.exec(processed);
  const commentContent = xmlCommentMatch?.[1]?.trim();
  if (commentContent && commentContent.startsWith('<') && commentContent.endsWith('>')) {
    processed = commentContent;
  }

  if (processed.includes('{"') && processed.includes('"<') && processed.includes('>"}')) {
    const jsonXmlMatch = processed.match(/["']([^"']*<[^"']*>[^"']*)["']/);
    if (jsonXmlMatch?.[1]) {
      processed = jsonXmlMatch[1];
    }
  }

  const firstTagIndex = processed.indexOf('<');
  if (firstTagIndex > 0) {
    processed = processed.substring(firstTagIndex);
  } else if (firstTagIndex === -1) {
    return null;
  }

  processed = processed.trim();
  if (!processed.startsWith('<') || !processed.endsWith('>')) {
    return processed;
  }

  return processed;
};

/**
 * Extract content between opening and closing wrapper tags
 * Handles multiple occurrences, returns innermost valid match
 */
export const extractBetweenTags = (text: string, startTag: string, endTag: string): string | null => {
  const startIndices: number[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = text.indexOf(startTag, cursor);
    if (index === -1) {
      break;
    }
    startIndices.push(index);
    cursor = index + 1;
  }

  for (let i = startIndices.length - 1; i >= 0; i--) {
    const startIndex = startIndices[i];
    if (startIndex === undefined) {
      continue;
    }

    const contentStart = startIndex + startTag.length;
    const endIndex = text.indexOf(endTag, contentStart);
    if (endIndex !== -1) {
      const content = text.substring(contentStart, endIndex).trim();
      if (content.startsWith('<') && content.includes('>')) {
        return content;
      }
    }
  }
  return null;
};
