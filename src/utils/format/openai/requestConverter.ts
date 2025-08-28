import { convertOllamaRequestToOpenAI } from "../ollama/requestConverter.js";

import type { OpenAIRequest } from "../../../types/index.js";

export function convertOpenAIRequestToOpenAI(openAIRequest: OpenAIRequest): OpenAIRequest {
  return { ...openAIRequest };
}

export { convertOllamaRequestToOpenAI };