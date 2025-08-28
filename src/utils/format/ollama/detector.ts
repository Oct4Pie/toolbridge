export function isOllamaFormat(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== "object") { return false; }
  const r = obj as Record<string, unknown>;

  // Ollama request/response typically has prompt/response/done fields
  if (typeof r.prompt === "string" || typeof r.response === "string" || typeof r.done === "boolean") {
    return true;
  }

  // Ollama response sometimes includes model and created_at
  if (typeof r.model === "string" && (typeof r.created_at === "number" || typeof r.created_at === "string") && (typeof r.response === "string" || typeof r.done === "boolean")) {
    return true;
  }

  return false;
}