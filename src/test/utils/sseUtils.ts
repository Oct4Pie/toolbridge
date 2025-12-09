import type { OpenAIStreamChunk } from "../../types/openai.js";

export async function readSSEBody(response: Response): Promise<string> {
  const reader = (response.body as unknown as ReadableStream<Uint8Array> | null)?.getReader();
  if (!reader) {
    return "";
  }
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) { break; }
    if (value) { chunks.push(decoder.decode(value, { stream: true })); }
  }
  return chunks.join("");
}

export function getSSEDataLines(fullText: string): string[] {
  return fullText.split("\n").filter(line => line.startsWith("data: "));
}

export function parseSSEChunks(fullText: string): OpenAIStreamChunk[] {
  const dataLines = getSSEDataLines(fullText);
  const chunks: OpenAIStreamChunk[] = [];
  for (const line of dataLines) {
    const payload = line.substring(6);
    if (payload === "[DONE]") { continue; }
    try {
      const parsed = JSON.parse(payload) as OpenAIStreamChunk;
      chunks.push(parsed);
    } catch { /* ignore */ }
  }
  return chunks;
}

