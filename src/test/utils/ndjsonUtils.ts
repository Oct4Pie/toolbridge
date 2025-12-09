export async function readNdjsonStream(response: Response): Promise<{ lines: string[]; done: boolean }>
{
  const reader = (response.body as unknown as ReadableStream<Uint8Array> | null)?.getReader();
  if (!reader) {
    return { lines: [], done: false };
  }
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let doneFlag = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const text = decoder.decode(value, { stream: true });
      const parsedLines = text.split("\n").filter(line => line.trim());
      for (const line of parsedLines) {
        lines.push(line);
        try {
          const json = JSON.parse(line);
          if (json && json.done === true) {
            doneFlag = true;
          }
        } catch {
          // ignore
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { lines, done: doneFlag };
}
