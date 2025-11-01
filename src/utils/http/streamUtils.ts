import type { Readable } from "stream";

export async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise<string>((resolve, reject) => {
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.from(chunk));
    });
    stream.on("error", (error: Error) => reject(error));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}