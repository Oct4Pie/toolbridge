import { convertOllamaResponseToOpenAI } from "../ollama/responseConverter.js";

import type { OpenAIResponse, OpenAIStreamChunk } from "../../../types/index.js";

export function convertOpenAIResponseToOpenAI(
  openAIResponse: OpenAIResponse | OpenAIStreamChunk
): OpenAIResponse | OpenAIStreamChunk {
  return { ...openAIResponse };
}

export { convertOllamaResponseToOpenAI };