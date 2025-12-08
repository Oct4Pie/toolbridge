/**
 * Tool call parameter extraction from XML
 * Extracted from toolCallParser.ts for KISS compliance
 */

import { logger } from "../../../logging/index.js";
import { decodeCdataAndEntities } from "../utils/xmlCleaning.js";
import { extractNestedObject, parseValue } from "../utils/xmlValueParsing.js";

const RAW_TEXT_PARAMS = new Set(["code", "html", "markdown", "md", "body", "content"]);

/**
 * Build arguments object from XML content
 * Handles:
 * - JSON-wrapped parameters
 * - Raw text parameters (code, html, markdown)
 * - Nested XML structures
 * - Multiple parameters with same name (arrays)
 */
export const buildArgumentsFromXml = (
  xml: string,
  options: {
    rawToolNames?: Set<string>;
    rootToolName?: string;
  } = {},
): Record<string, unknown> => {
  const params: Record<string, unknown> = {};
  const rootToolName = options.rootToolName;

  const contentRegex = rootToolName
    ? new RegExp(`<\\s*${rootToolName}[^>]*>([\\s\\S]*?)<\\/${rootToolName}>`, 'i')
    : null;

  const contentMatch = contentRegex ? contentRegex.exec(xml) : null;
  let content = contentMatch?.[1] ?? xml;

  // Try parsing as JSON first
  const trimmedContent = content.trim();
  if (trimmedContent.startsWith('{') && trimmedContent.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmedContent);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      logger.debug("[XML Parser] JSON parsing failed; falling back to XML parsing");
    }
  }

  // Extract all parameters using regex (respects proper XML nesting)
  // Regex allows optional attributes: <tag attr="value">content</tag>
  const paramRegex = /<([a-zA-Z0-9_.-]+)[^>]*>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;

  while ((match = paramRegex.exec(content)) !== null) {
    const paramName = match[1];
    if (!paramName) {
      continue;
    }

    let paramValue: unknown = match[2];
    const isRawToolName = options.rawToolNames?.has(paramName.toLowerCase());
    const shouldPreserveForThink =
      options.rootToolName === "think" &&
      (paramName.toLowerCase() === "points" || paramName.toLowerCase() === "thoughts");

    if (RAW_TEXT_PARAMS.has(paramName.toLowerCase())) {
      // Raw text parameter - preserve as text but decode entities
      paramValue = decodeCdataAndEntities(match[2] as string);
    } else if (isRawToolName) {
      // Parameter name matches a known tool name - preserve as raw XML
      paramValue = match[2];
    } else if (shouldPreserveForThink) {
      // Special handling for think tool - preserve points/thoughts as raw XML
      paramValue = match[2];
    } else if (typeof paramValue === 'string' && paramValue.includes('<') && paramValue.includes('>')) {
      // Try to extract as nested XML object
      const nestedObj = extractNestedObject(paramValue);
      const hasValidChildren = Object.keys(nestedObj).length > 0;

      if (hasValidChildren) {
        // Successfully extracted nested structure
        // Special case: if nested object has only "item" key with array value, unwrap to array
        const nestedKeys = Object.keys(nestedObj);
        if (nestedKeys.length === 1 && nestedKeys[0] === "item" && Array.isArray(nestedObj['item'])) {
          paramValue = nestedObj['item'];
        } else {
          paramValue = nestedObj;
        }
      } else {
        // Malformed XML or intentional raw content - treat as text
        paramValue = decodeCdataAndEntities(paramValue);
      }
    } else if (typeof paramValue === 'string') {
      paramValue = parseValue(paramValue);
    }

    if (Object.prototype.hasOwnProperty.call(params, paramName)) {
      const existing = params[paramName];
      if (Array.isArray(existing)) {
        existing.push(paramValue);
      } else {
        params[paramName] = [existing, paramValue];
      }
    } else {
      params[paramName] = paramValue;
    }
  }

  return params;
};
