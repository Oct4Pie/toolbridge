/**
 * XML value parsing and type conversion utilities
 * Extracted from toolCallParser.ts for KISS compliance
 */

import { decodeCdataAndEntities } from "./xmlCleaning.js";

/**
 * Parse a string value to appropriate type (string, number, boolean)
 */
export const parseValue = (value: string): string | number | boolean => {
  const trimmed = value.trim();
  // Check if trimmed version is a boolean
  if (trimmed.toLowerCase() === 'true') {
    return true;
  }
  if (trimmed.toLowerCase() === 'false') {
    return false;
  }
  // Check if trimmed version is a number
  if (!Number.isNaN(Number(trimmed)) && trimmed !== '') {
    return Number(trimmed);
  }
  // Return original value with CDATA/entities decoded (preserve whitespace)
  return decodeCdataAndEntities(value);
};

/**
 * Extract nested object structure from XML
 * Handles recursive nesting and arrays
 */
export const extractNestedObject = (xml: string): Record<string, unknown> => {
  const obj: Record<string, unknown> = {};
  const paramRegex = /<([a-zA-Z0-9_.-]+)[^>]*>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;

  while ((match = paramRegex.exec(xml)) !== null) {
    const key = match[1];
    let value: unknown = match[2];

    if (typeof value === 'string' && value.includes('<') && value.includes('>')) {
      value = extractNestedObject(value);
    } else if (typeof value === 'string') {
      value = parseValue(value);
    }

    if (key !== undefined && Object.prototype.hasOwnProperty.call(obj, key)) {
      const existing = obj[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        obj[key] = [existing, value];
      }
    } else if (key !== undefined) {
      obj[key] = value;
    }
  }

  return obj;
};
