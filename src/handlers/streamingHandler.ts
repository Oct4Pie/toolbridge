
import logger from "../utils/logger.js";

import { FORMAT_OLLAMA, FORMAT_OPENAI } from "./formatDetector.js";
import { FormatConvertingStreamProcessor } from "./stream/formatConvertingStreamProcessor.js";
import { OllamaStreamProcessor } from "./stream/ollamaStreamProcessor.js";
import { OpenAIStreamProcessor } from "./stream/openaiStreamProcessor.js";
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
): void {
  logger.debug(
    `[STREAM] Setting up handler: client=${clientRequestFormat}, backend=${backendFormat}`,
  );
  logger.debug(`[STREAM] Tools received:`, tools.length, tools);

  let processor: StreamProcessor;

  if (
    clientRequestFormat === FORMAT_OPENAI &&
    backendFormat === FORMAT_OPENAI
  ) {
    logger.debug("[STREAM] Using OpenAI-to-OpenAI with wrapper-aware processor.");
    const baseProcessor = new OpenAIStreamProcessor(res);
    processor = new WrapperAwareStreamProcessor(baseProcessor);
    if (processor.setTools) {
      processor.setTools(tools);
    }
  } else if (
    clientRequestFormat === FORMAT_OLLAMA &&
    backendFormat === FORMAT_OLLAMA
  ) {
    logger.debug("[STREAM] Using Ollama-to-Ollama pass-through processor.");
    processor = new OllamaStreamProcessor(res);
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
  OpenAIStreamProcessor as StreamProcessorConstructor,
  OllamaStreamProcessor as StreamProcessorConstructor,
  FormatConvertingStreamProcessor as StreamProcessorConstructor,
];

streamProcessors.forEach((Processor: StreamProcessorConstructor) => {
  if (Processor.prototype.pipeFrom == null) {
    Processor.prototype.pipeFrom = function(sourceStream: Readable): void {
      sourceStream.on("data", (chunk: Buffer | string) => {
        try {
          this.processChunk(chunk);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.error(
            `[STREAM] Error processing chunk in ${this.constructor.name}:`,
            error,
          );
          this.closeStreamWithError(
            `Error processing stream chunk: ${errorMessage}`,
          );
          sourceStream.destroy();
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
  }
});