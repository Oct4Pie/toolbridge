export function isOllamaFormat(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== "object") { return false; }
  const record = obj as Record<string, unknown>;

  if (typeof record["prompt"] === "string" || typeof record["response"] === "string" || typeof record["done"] === "boolean") {
    return true;
  }

  if (
    typeof record["model"] === "string"
    && (typeof record["created_at"] === "number" || typeof record["created_at"] === "string")
    && (typeof record["response"] === "string" || typeof record["done"] === "boolean")
  ) {
    return true;
  }

  return false;
}
