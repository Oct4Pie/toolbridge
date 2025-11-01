import type { ConversionContext, LLMProvider } from "../types/index.js";

export function createConversionContext(
  from: LLMProvider,
  to: LLMProvider,
  partial: Partial<ConversionContext> = {}
): ConversionContext {
  const knownToolNames = Array.isArray(partial.knownToolNames)
    ? partial.knownToolNames.filter((name): name is string => Boolean(name))
    : [];

  const enableXML =
    typeof partial.enableXMLToolParsing === "boolean"
      ? partial.enableXMLToolParsing
      : knownToolNames.length > 0;

  return {
    sourceProvider: from,
    targetProvider: to,
    requestId: partial.requestId ?? Math.random().toString(36).slice(2, 11),
    preserveExtensions: partial.preserveExtensions ?? true,
    strictMode: partial.strictMode ?? false,
    knownToolNames,
    enableXMLToolParsing: enableXML,
    transformationLog: Array.isArray(partial.transformationLog) ? partial.transformationLog : [],
  };
}
