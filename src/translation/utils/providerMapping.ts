import type { RequestFormat } from "../../types/toolbridge.js";
import type { LLMProvider } from "../types/index.js";

export function formatToProvider(format: RequestFormat): LLMProvider {
  switch (format) {
    case "openai":
      return "openai";
    case "ollama":
      return "ollama";
    default:
      return "openai";
  }
}

export function providerToFormat(provider: LLMProvider): RequestFormat {
  switch (provider) {
    case "openai":
      return "openai";
    case "ollama":
      return "ollama";
    default:
      return "openai";
  }
}
