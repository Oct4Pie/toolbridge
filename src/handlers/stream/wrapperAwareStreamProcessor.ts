
import { logger } from "../../logging/index.js";
import { extractToolCallFromWrapper } from "../../parsers/xml/index.js";
import {
  createChatStreamChunk,
  createFunctionCallStreamChunks,
  formatSSEChunk,
} from "../../utils/http/index.js";
// import { detectPotentialToolCall } from "../toolCallHandler.js"; // Unused import
// No buffer sizing import needed under wrappers-only mode

import type {
  OpenAITool,
  StreamProcessor,
  ExtractedToolCall,
} from "../../types/index.js"; // Removed unused ToolCallDetectionResult
import type { Response } from "express";
import type { Readable } from "stream";

// Wrapper tags to look for
const WRAPPER_START = '<toolbridge:calls>';
const WRAPPER_END = '</toolbridge:calls>';
// Wrappers-only mode: no separate unwrapped buffer sizing needed

export class WrapperAwareStreamProcessor implements StreamProcessor {
  public originalProcessor: StreamProcessor;
  public res?: Response | undefined;
  public buffer: string = "";
  public inWrapper: boolean = false;
  public wrapperContent: string = "";
  public beforeWrapperContent: string = "";
  public knownToolNames: string[] = [];
  // Wrappers-only policy: no unwrapped detection buffers/state

  constructor(originalProcessor: StreamProcessor) {
    this.originalProcessor = originalProcessor;
  this.res = originalProcessor.res ?? undefined;
    this.buffer = "";
    this.inWrapper = false;
    this.wrapperContent = "";
    this.beforeWrapperContent = "";
    this.knownToolNames = [];
  // No unwrapped buffers under wrappers-only policy
  }

  setTools(tools?: OpenAITool[]): void {
    this.knownToolNames = (tools ?? []).map((t) => t.function.name).filter((name): name is string => Boolean(name));
    logger.debug("[WRAPPER PROCESSOR] Known tool names set:", this.knownToolNames);

    if (typeof this.originalProcessor.setTools === 'function') {
      this.originalProcessor.setTools(tools ?? []);
    }
  }

  processChunk(chunk: Buffer | string): void {
    let chunkString = chunk.toString("utf-8");
    
    // Filter out SSE comments first (per SSE specification)
    const lines = chunkString.split('\n');
    const filteredLines = lines.filter(line => {
      if (line.startsWith(': ')) {
        logger.debug("[WRAPPER PROCESSOR] Ignoring SSE comment:", line.substring(0, 50));
        return false;
      }
      return true;
    });
    chunkString = filteredLines.join('\n');
    
    // Handle nested SSE format from OpenRouter - content contains "data: {json}"
    if (chunkString.includes('data: {')) {
      let extractedContent = '';
      
      // Split by SSE data lines and extract content from each
      const dataLines = chunkString.split('\n\n').filter(line => line.startsWith('data: '));
      
      for (const dataLine of dataLines) {
        try {
          const nestedJsonStr = dataLine.substring(6); // Remove "data: " prefix
          const nestedJson = JSON.parse(nestedJsonStr);
          
          if (nestedJson.choices?.[0]?.delta?.content !== undefined) {
            extractedContent += nestedJson.choices[0].delta.content;
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.debug("[WRAPPER PROCESSOR] Failed to parse nested JSON line:", errorMessage);
        }
      }
      
      if (extractedContent) {
        logger.debug("[WRAPPER PROCESSOR] Extracted content from nested SSE format:", extractedContent);
        chunkString = extractedContent;
      }
    }
    
    this.buffer += chunkString;
    
    // Check if we have a complete wrapper (use clean version for checking)
    while (this.checkForCompleteWrapper()) {
      // Process the complete wrapped tool call
      this.processWrappedToolCall();
    }
    
    // If no wrapper detected, flush as text (wrappers-only policy)
    if (!this.inWrapper && !this.buffer.includes(WRAPPER_START)) {
      if (this.buffer.length > 0) {
        this.sendTextContent(this.buffer);
        this.buffer = "";
      }
    }
  }

  
  // getCleanBufferForParsing removed; not needed in wrappers-only policy

  // Removed unused method processUnwrappedToolCall

  // emitToolCallAndDone kept inlined usage within processWrappedToolCall

  // No unwrapped state to reset/flush under wrappers-only policy

  private checkForCompleteWrapper(): boolean {
    // When already inside a wrapper, we must accumulate into wrapperContent
    // and search for the end tag across the combined content.
    const originalTarget = this.inWrapper
      ? (this.wrapperContent + this.buffer)
      : this.buffer;

    // Use clean buffer only for detection (strips thinking tags), but always
    // compute slicing indices against the ORIGINAL target to avoid misalignment.
  // Intentionally not using cleaned buffer for slicing; detection mismatches can corrupt indices.
  // Keeping parsing helper available for future enhancements if needed.
  // const cleanTarget = this.getCleanBufferForParsing(originalTarget);

    // Find start index in ORIGINAL target
    const originalStartIndex = this.inWrapper ? 0 : originalTarget.indexOf(WRAPPER_START);

    // No wrapper start found (and not currently buffering one)
    if (!this.inWrapper && originalStartIndex === -1) {
      return false;
    }

    // Find end index in ORIGINAL target, starting after originalStartIndex (or 0 if buffering)
    const searchFrom = Math.max(0, this.inWrapper ? 0 : originalStartIndex);
    const originalEndIndex = originalTarget.indexOf(WRAPPER_END, searchFrom);

    if (originalEndIndex === -1) {
      // Start found but no end yet, enter/continue buffering mode
      this.inWrapper = true;

      if (!this.wrapperContent) {
        // Save content before wrapper (from original buffer, preserving thinking)
        if (originalStartIndex > 0) {
          const before = this.buffer.substring(0, originalStartIndex);
          this.beforeWrapperContent = before;
          this.sendTextContent(before);
        }
        // Initialize wrapper content from the ORIGINAL target
        this.wrapperContent = originalTarget.substring(originalStartIndex);
      } else {
        // Append newly received buffer to wrapper content
        this.wrapperContent = (this.wrapperContent + this.buffer);
      }

      // We've consumed current buffer into wrapperContent
      this.buffer = "";
      return false;
    }

    // Complete wrapper found across ORIGINAL target content
    const wrapperEndPos = originalEndIndex + WRAPPER_END.length;

    if (!this.inWrapper) {
      // Send any content before the wrapper start from the ORIGINAL buffer
      if (originalStartIndex > 0) {
        const beforeContent = this.buffer.substring(0, originalStartIndex);
        this.sendTextContent(beforeContent);
      }

      // Extract wrapped content directly from ORIGINAL buffer
      const wrappedContent = this.buffer.substring(originalStartIndex, wrapperEndPos);
      this.wrapperContent = wrappedContent;

      // Keep remaining content in buffer
      this.buffer = this.buffer.substring(wrapperEndPos);
    } else {
      // We are in buffering mode, so take wrapped content and remainder from combined ORIGINAL target
      this.wrapperContent = originalTarget.substring(0, wrapperEndPos);
      this.buffer = originalTarget.substring(wrapperEndPos);
    }

    // We now have a complete wrapper in wrapperContent
    return true;
  }

  private processWrappedToolCall(): void {
    logger.debug("[WRAPPER PROCESSOR] Processing complete wrapped tool call");
    
    // Extract tool call from wrapper
    const toolCall: ExtractedToolCall | null = extractToolCallFromWrapper(this.wrapperContent, this.knownToolNames);
    
    if (toolCall?.name) {
      logger.debug(`[WRAPPER PROCESSOR] Valid tool call found: ${toolCall.name}`);
      
      // Send tool call chunks
      const functionCallChunks = createFunctionCallStreamChunks(
        toolCall,
        null, // id will be generated
        null  // model will be added later
      );
      
      const op = this.originalProcessor;
      functionCallChunks.forEach((chunk) => {
        const sseString = formatSSEChunk(chunk);
        if (op.res) {
          op.res.write(sseString);
        }
      });
      
      // Send [DONE] signal
      const op2 = this.originalProcessor;
      if (op2.res) {
        op2.res.write("data: [DONE]\n\n");
        if (typeof op2.end === 'function') { op2.end(); }
      }
    } else {
      logger.warn("[WRAPPER PROCESSOR] Invalid or unrecognized tool in wrapper");
      // Send the content as regular text
      this.sendTextContent(this.wrapperContent);
    }
    
    // Reset wrapper state
    this.wrapperContent = "";
    this.inWrapper = false;
  }

  private sendTextContent(content: string): void {
    if (content.length === 0 || !this.originalProcessor.res) { return; }
    
    const textChunk = createChatStreamChunk(
      null, // id
      null, // model
      content,
      null  // finish reason
    );
    
    const sseString = formatSSEChunk(textChunk);
    this.originalProcessor.res.write(sseString);
  }

  handleDone(): void {
    // Check if we have incomplete wrapper content
    if (this.inWrapper === true && this.wrapperContent.length > 0) {
      logger.warn("[WRAPPER PROCESSOR] Stream ended with incomplete wrapper");
      // Send the incomplete content as regular text
      this.sendTextContent(this.wrapperContent);
    }
    // Flush any remaining plain text in buffer
    if (!this.inWrapper && this.buffer.length > 0) {
      this.sendTextContent(this.buffer);
      this.buffer = "";
    }
    
    // Pass through to original processor
    if (typeof this.originalProcessor.handleDone === 'function') {
      this.originalProcessor.handleDone();
    }
  }

  end(): void {
    if (typeof this.originalProcessor.end === 'function') {
      this.originalProcessor.end();
    }
  }

  closeStream(message: string | null = null): void {
    if (typeof this.originalProcessor.closeStream === 'function') {
      this.originalProcessor.closeStream(message);
    }
  }

  closeStreamWithError(errorMessage: string): void {
    if (typeof this.originalProcessor.closeStreamWithError === 'function') {
      this.originalProcessor.closeStreamWithError(errorMessage);
    }
  }

  pipeFrom(stream: Readable): void {
    // Set up stream processing
    stream.on('data', (chunk: Buffer | string) => {
      this.processChunk(chunk);
    });

    stream.on('end', () => {
      this.handleDone();
    });

    stream.on('error', (error: Error) => {
      logger.error("[WRAPPER PROCESSOR] Stream error:", error);
      this.closeStreamWithError(error.message);
    });
  }
}