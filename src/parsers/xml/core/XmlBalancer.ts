/**
 * XML element balancing and region finding
 * Extracted from toolCallParser.ts for KISS compliance
 */

import {
  parseStartTag,
  parseEndTag,
  readUntil,
  type StartTag,
} from "../utils/xmlParsing.js";

export interface ElementRegion {
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
}

/**
 * Find a balanced XML element by tag name
 * Handles nested elements with same name (depth tracking)
 */
export const findBalancedElement = (
  text: string,
  targetLocalName: string,
  startIndex = 0,
): ElementRegion | null => {
  let pointer = startIndex;
  while (pointer < text.length) {
    const nextLt = text.indexOf('<', pointer);
    if (nextLt < 0) {
      return null;
    }

    if (text.startsWith('<!--', nextLt)) {
      pointer = readUntil(text, nextLt + 4, '-->');
      continue;
    }
    if (text.startsWith('<![CDATA[', nextLt)) {
      pointer = readUntil(text, nextLt + 9, ']]>');
      continue;
    }
    if (text.startsWith('<?', nextLt)) {
      pointer = readUntil(text, nextLt + 2, '?>');
      continue;
    }

    const startTag = parseStartTag(text, nextLt);
    if (startTag) {
      if (startTag.local.toLowerCase() !== targetLocalName.toLowerCase()) {
        pointer = startTag.end;
        continue;
      }
      if (startTag.selfClosing) {
        return {
          start: startTag.start,
          openEnd: startTag.end,
          closeStart: startTag.end,
          end: startTag.end,
        };
      }

      let depth = 1;
      let scan = startTag.end;
      while (scan < text.length) {
        const innerLt = text.indexOf('<', scan);
        if (innerLt < 0) {
          break;
        }
        if (text.startsWith('<!--', innerLt)) {
          scan = readUntil(text, innerLt + 4, '-->');
          continue;
        }
        if (text.startsWith('<![CDATA[', innerLt)) {
          scan = readUntil(text, innerLt + 9, ']]>');
          continue;
        }
        if (text.startsWith('<?', innerLt)) {
          scan = readUntil(text, innerLt + 2, '?>');
          continue;
        }
        if (text[innerLt + 1] === '/') {
          const endTag = parseEndTag(text, innerLt);
          if (endTag && endTag.local.toLowerCase() === targetLocalName.toLowerCase()) {
            depth--;
            if (depth === 0) {
              return {
                start: startTag.start,
                openEnd: startTag.end,
                closeStart: innerLt,
                end: endTag.end,
              };
            }
          }
          scan = endTag ? endTag.end : innerLt + 2;
          continue;
        }
        const nestedStart = parseStartTag(text, innerLt);
        if (nestedStart) {
          if (!nestedStart.selfClosing && nestedStart.local.toLowerCase() === targetLocalName.toLowerCase()) {
            depth++;
          }
          scan = nestedStart.end;
          continue;
        }
        scan = innerLt + 1;
      }

      return null;
    }

    pointer = nextLt + 1;
  }
  return null;
};

/**
 * Synthesize a region for an unbalanced element
 * Attempts to find a closing tag, falls back to end of text
 */
export const synthesizeRegionForUnbalancedElement = (
  text: string,
  startTag: StartTag,
): ElementRegion => {
  // First try: complete closing tag with '>'
  const closeRegex = new RegExp(`<\\s*/\\s*${startTag.name}\\s*>`, 'i');
  const remainder = text.slice(startTag.end);
  const match = closeRegex.exec(remainder);
  if (match) {
    const closeStart = startTag.end + match.index;
    const closeEnd = closeStart + match[0].length;
    return { start: startTag.start, openEnd: startTag.end, closeStart, end: closeEnd };
  }

  // Second try: incomplete closing tag without '>' (streaming edge case)
  const incompleteCloseRegex = new RegExp(`<\\s*/\\s*${startTag.name}\\s*$`, 'i');
  const incompleteMatch = incompleteCloseRegex.exec(remainder);
  if (incompleteMatch) {
    const closeStart = startTag.end + incompleteMatch.index;
    const closeEnd = closeStart + incompleteMatch[0].length;
    // Treat the incomplete tag as if it were complete
    return { start: startTag.start, openEnd: startTag.end, closeStart, end: closeEnd };
  }

  return {
    start: startTag.start,
    openEnd: startTag.end,
    closeStart: text.length,
    end: text.length,
  };
};
