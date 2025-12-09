export function isOpenAIFormat(obj: unknown): obj is Record<string, unknown> {
  if (obj !== null && typeof obj === "object") {
    const record = obj as Record<string, unknown>;

    if (Array.isArray(record["messages"]) || Array.isArray(record["choices"])) {
      return true;
    }

    if (typeof record["object"] === "string" && record["object"] === "chat.completion.chunk" && Array.isArray(record["choices"])) {
      return true;
    }
  }
  return false;
}
