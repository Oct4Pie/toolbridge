
import { logger } from "../logging/index.js";

import { FORMAT_OLLAMA, FORMAT_OPENAI } from "./formatDetector.js";
import { FormatConvertingStreamProcessor } from "./stream/formatConvertingStreamProcessor.js";
import { OllamaLineJSONStreamProcessor } from "./stream/processors/OllamaLineJSONStreamProcessor.js";
import { OpenAISSEStreamProcessor } from "./stream/processors/OpenAISSEStreamProcessor.js";
import { WrapperAwareStreamProcessor } from "./stream/wrapperAwareStreamProcessor.js";

import type {
  RequestFormat,
  OpenAITool,
  StreamProcessor,
  OllamaRequest
} from "../types/index.js";
import type { Response } from "express";
import type { Readable } from "stream";

// Augment the stream processor prototypes with pipeFrom method
interface StreamProcessorConstructor {
  new(...args: unknown[]): StreamProcessor;
  prototype: StreamProcessor & {
    pipeFrom?: (sourceStream: Readable) => void;
    processChunk: (chunk: Buffer | string) => void;
    end: () => void;
    closeStreamWithError: (errorMessage: string) => void;
    constructor: { name: string };
  };
}

const isOllamaChatStreamingRequest = (body: unknown): body is Pick<OllamaRequest, "messages" | "stream"> => {
  if (!body || typeof body !== "object") {
    return false;
  }

  const candidate = body as Partial<OllamaRequest>;
  return candidate.stream === true && Array.isArray(candidate.messages) && candidate.messages.length > 0;
};

export function setupStreamHandler(
  backendStream: Readable,
  res: Response,
  clientRequestFormat: RequestFormat = FORMAT_OPENAI,
  backendFormat: RequestFormat = FORMAT_OPENAI,
  tools: OpenAITool[] = [],
  streamOptions?: { include_usage?: boolean },
  clientRequestBody?: unknown,
): void {
  logger.debug(
    `[STREAM] Setting up handler: client=${clientRequestFormat}, backend=${backendFormat}`,
  );
  logger.debug(`[STREAM] Tools received:`, tools.length, tools);
  logger.debug(`[STREAM] Stream options:`, streamOptions);

  logger.info(`[STREAM DEBUG] clientFormat=${clientRequestFormat}, backendFormat=${backendFormat}`);

  let processor: StreamProcessor;
  const shouldUseOllamaSSE =
    clientRequestFormat === FORMAT_OLLAMA &&
    backendFormat === FORMAT_OPENAI &&
    isOllamaChatStreamingRequest(clientRequestBody);

  if (
    clientRequestFormat === FORMAT_OPENAI &&
    backendFormat === FORMAT_OPENAI
  ) {
  logger.debug("[STREAM] Using OpenAI SSE processor (OpenAI backend).");
    logger.info("[STREAM DEBUG] Using OpenAI SSE processor");
    const baseProcessor = new OpenAISSEStreamProcessor(res);
    baseProcessor.setStreamOptions(streamOptions);
    processor = new WrapperAwareStreamProcessor(baseProcessor);
    if (processor.setTools) {
      processor.setTools(tools);
    }
  } else if (
    clientRequestFormat === FORMAT_OLLAMA &&
    backendFormat === FORMAT_OLLAMA
  ) {
    logger.debug("[STREAM] Using Ollama Line-JSON processor (Ollama native backend).");
    logger.info("[STREAM DEBUG] Using Ollama Line-JSON processor (Ollama → Ollama)");
    processor = new OllamaLineJSONStreamProcessor(res);
    processor.setStreamOptions?.(streamOptions);
    if (processor.setTools) {
      processor.setTools(tools);
    }
  } else {
    logger.debug(
      `[STREAM] Using format converting processor (${backendFormat} -> ${clientRequestFormat}).`,
    );
    logger.info(`[STREAM DEBUG] Using FormatConvertingStreamProcessor (${backendFormat} → ${clientRequestFormat})`);
    processor = new FormatConvertingStreamProcessor(
      res,
      backendFormat,
      clientRequestFormat,
      shouldUseOllamaSSE ? { targetStreamMode: 'sse' } : undefined
    );
    if (processor.setTools) {
      processor.setTools(tools);
    }
  }

  if (processor.pipeFrom) {
    processor.pipeFrom(backendStream);
  }
}

// Add pipeFrom method to stream processors that don't have it
const streamProcessors: StreamProcessorConstructor[] = [
  OpenAISSEStreamProcessor as StreamProcessorConstructor,
  OllamaLineJSONStreamProcessor as StreamProcessorConstructor,
  FormatConvertingStreamProcessor as StreamProcessorConstructor,
];

streamProcessors.forEach((Processor: StreamProcessorConstructor) => {
  Processor.prototype.pipeFrom ??= function(sourceStream: Readable): void {
    // Flag to prevent race condition in stream cleanup (double-destroy scenarios)
    let cleanupInProgress = false;
    
    const safeDestroySourceStream = (): void => {
      if (cleanupInProgress || sourceStream.destroyed) {
        return;
      }
      cleanupInProgress = true;
      sourceStream.destroy();
    };
    
    // Handle client disconnect - cleanup backend stream to avoid wasting resources
    if (this.res && !this.res.writableEnded) {
      this.res.on('close', () => {
        logger.debug(`[STREAM] Client disconnected, cleaning up backend stream for ${this.constructor.name}`);
        safeDestroySourceStream();
      });
    }

    sourceStream.on("data", (chunk: Buffer | string) => {
      const handleError = (error: unknown): void => {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(
          `[STREAM] Error processing chunk in ${this.constructor.name}:`,
          error,
        );
        this.closeStreamWithError(
          `Error processing stream chunk: ${errorMessage}`,
        );
        safeDestroySourceStream();
      };

      try {
        const result = this.processChunk(chunk);
        if (result && typeof (result as Promise<unknown>).then === "function") {
          (result as Promise<unknown>).catch(handleError);
        }
      } catch (error: unknown) {
        handleError(error);
      }
    });

    sourceStream.on("end", () => {
      try {
        this.end();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(
          `[STREAM] Error finalizing stream in ${this.constructor.name}:`,
          error,
        );
        this.closeStreamWithError(`Error finalizing stream: ${errorMessage}`);
      }
    });

    sourceStream.on("error", (error: Error) => {
      logger.error("[STREAM] Backend stream error:", error);
      this.closeStreamWithError(`Stream error from backend: ${error.message}`);
    });
  };
});