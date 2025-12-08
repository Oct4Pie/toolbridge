/**
 * Low-level XML parsing utilities
 * Extracted from toolCallParser.ts for KISS compliance
 */

/**
 * Check if a character is a valid XML name character
 */
export const isNameChar = (ch: string): boolean => /[A-Za-z0-9_.:-]/.test(ch);

/**
 * Extract local name from a qualified name (strip namespace prefix)
 */
export const getLocalName = (qName: string): string => {
  const idx = qName.lastIndexOf(":");
  return idx >= 0 ? qName.slice(idx + 1) : qName;
};

/**
 * Read text until a terminator string is found
 */
export const readUntil = (text: string, start: number, terminator: string): number => {
  const end = text.indexOf(terminator, start);
  return end >= 0 ? end + terminator.length : text.length;
};

/**
 * Skip over a tag's body (handles quotes properly)
 */
export const skipTagBody = (text: string, start: number): number => {
  let inQuote: '"' | "'" | null = null;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inQuote = char;
      continue;
    }
    if (char === '>') {
      return i + 1;
    }
  }
  return text.length;
};

/**
 * Parse tag name from text at given position
 * Extracted to eliminate duplication between parseStartTag and parseEndTag (DRY)
 */
const parseTagName = (text: string, startPointer: number): { name: string; endPointer: number } | null => {
  let pointer = startPointer;
  let name = '';
  while (pointer < text.length) {
    const char = text[pointer];
    if (!char || !isNameChar(char)) {
      break;
    }
    name += char;
    pointer++;
  }
  if (!name) {
    return null;
  }
  return { name, endPointer: pointer };
};

/**
 * Parse a start tag from text at a given index
 */
export type StartTag = {
  name: string;
  local: string;
  start: number;
  end: number;
  selfClosing: boolean;
};

export const parseStartTag = (text: string, index: number): StartTag | null => {
  let pointer = index + 1;
  if (pointer >= text.length) {
    return null;
  }

  const next = text[pointer];
  if (next === '/' || next === '!' || next === '?') {
    return null;
  }

  const parsed = parseTagName(text, pointer);
  if (!parsed) {
    return null;
  }
  const { name, endPointer } = parsed;
  pointer = endPointer;

  let afterName = pointer;
  afterName = skipTagBody(text, afterName);
  const raw = text.slice(index, afterName);
  const selfClosing = /\/>\s*$/.test(raw);
  return {
    name,
    local: getLocalName(name),
    start: index,
    end: afterName,
    selfClosing,
  };
};

/**
 * Parse an end tag from text at a given index
 */
export const parseEndTag = (text: string, index: number): { name: string; local: string; end: number } | null => {
  const parsed = parseTagName(text, index + 2);
  if (!parsed) {
    return null;
  }
  let { name, endPointer: pointer } = parsed;
  while (pointer < text.length && text[pointer] !== '>') {
    pointer++;
  }
  return {
    name,
    local: getLocalName(name),
    end: pointer < text.length ? pointer + 1 : pointer,
  };
};
