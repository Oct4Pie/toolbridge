
import { logger } from "../logging/index.js";

import { FORMAT_OLLAMA, FORMAT_OPENAI } from "./formatDetector.js";
import { FormatConvertingStreamProcessor } from "./stream/formatConvertingStreamProcessor.js";
import { OllamaLineJSONStreamProcessor } from "./stream/ollamaLineJSONStreamProcessor.js";
import { OpenAISSEStreamProcessor } from "./stream/openaiSSEStreamProcessor.js";
import { WrapperAwareStreamProcessor } from "./stream/wrapperAwareStreamProcessor.js";

import type {
  RequestFormat,
  OpenAITool,
  StreamProcessor
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

export function setupStreamHandler(
  backendStream: Readable,
  res: Response,
  clientRequestFormat: RequestFormat = FORMAT_OPENAI,
  backendFormat: RequestFormat = FORMAT_OPENAI,
  tools: OpenAITool[] = [],
  streamOptions?: { include_usage?: boolean },
): void {
  logger.debug(
    `[STREAM] Setting up handler: client=${clientRequestFormat}, backend=${backendFormat}`,
  );
  logger.debug(`[STREAM] Tools received:`, tools.length, tools);
  logger.debug(`[STREAM] Stream options:`, streamOptions);

  let processor: StreamProcessor;

  if (
    clientRequestFormat === FORMAT_OPENAI &&
    backendFormat === FORMAT_OPENAI
  ) {
  logger.debug("[STREAM] Using OpenAI SSE processor (OpenAI backend).");
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
    processor = new OllamaLineJSONStreamProcessor(res);
    processor.setStreamOptions?.(streamOptions);
    if (processor.setTools) {
      processor.setTools(tools);
    }
  } else {
    logger.debug(
      `[STREAM] Using format converting processor (${backendFormat} -> ${clientRequestFormat}).`,
    );
    processor = new FormatConvertingStreamProcessor(
      res,
      backendFormat,
      clientRequestFormat,
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
    // Handle client disconnect - cleanup backend stream to avoid wasting resources
    if (this.res && !this.res.writableEnded) {
      this.res.on('close', () => {
        logger.debug(`[STREAM] Client disconnected, cleaning up backend stream for ${this.constructor.name}`);
        if (!sourceStream.destroyed) {
          sourceStream.destroy();
        }
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
        sourceStream.destroy();
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