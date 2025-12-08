import type { OpenAITool, StreamProcessor } from "../../types/index.js";
import type { Readable } from "stream";

export class WrapperAwareStreamProcessor implements StreamProcessor {
  public originalProcessor: StreamProcessor;

  constructor(originalProcessor: StreamProcessor) {
    this.originalProcessor = originalProcessor;
  }

  setTools(tools?: OpenAITool[]): void {
    if (typeof this.originalProcessor.setTools === "function") {
      this.originalProcessor.setTools(tools ?? []);
    }
  }

  processChunk(chunk: Buffer | string): void | Promise<void> {
    return this.originalProcessor.processChunk(chunk);
  }

  handleDone(): void {
    if (typeof this.originalProcessor.handleDone === "function") {
      this.originalProcessor.handleDone();
    }
  }

  end(): void {
    if (typeof this.originalProcessor.end === "function") {
      this.originalProcessor.end();
    }
  }

  closeStream(message: string | null = null): void {
    if (typeof this.originalProcessor.closeStream === "function") {
      this.originalProcessor.closeStream(message);
    }
  }

  closeStreamWithError(errorMessage: string): void {
    if (typeof this.originalProcessor.closeStreamWithError === "function") {
      this.originalProcessor.closeStreamWithError(errorMessage);
    }
  }

  pipeFrom(stream: Readable): void {
    if (typeof this.originalProcessor.pipeFrom === "function") {
      this.originalProcessor.pipeFrom(stream);
      return;
    }

    stream.on("data", (chunk: Buffer | string) => {
      void Promise.resolve(this.processChunk(chunk));
    });

    stream.on("end", () => {
      this.handleDone();
    });

    stream.on("error", (error: Error) => {
      this.closeStreamWithError(error.message);
    });
  }
}