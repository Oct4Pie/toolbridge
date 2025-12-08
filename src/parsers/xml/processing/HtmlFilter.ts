/**
 * HTML tag detection and filtering
 * Extracted from toolCallParser.ts for KISS compliance
 *
 * LLMs sometimes start responses with HTML tags before tool calls.
 * This module detects and handles that case.
 */

const COMMON_HTML_TAGS = [
  "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "style", "script", "link", "meta", "title", "head", "body", "html",
  "form", "input", "button", "textarea", "select", "option",
];

/**
 * Regex to detect if content starts with a common HTML tag
 */
export const htmlStartRegex = new RegExp(`^\\s*<(${COMMON_HTML_TAGS.join("|")})\\b`, "i");

/**
 * Check if text starts with a common HTML tag
 */
export const startsWithHtmlTag = (text: string): boolean => {
  return htmlStartRegex.test(text);
};

/**
 * Get the HTML tag name if text starts with one
 */
export const getHtmlTagName = (text: string): string | null => {
  const match = text.match(htmlStartRegex);
  return match?.[1] ?? null;
};
