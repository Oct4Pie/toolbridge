
import logger from "../../utils/logger.js";
import {
  createChatStreamChunk,
  createFunctionCallStreamChunks,
  formatSSEChunk,
} from "../../utils/sseUtils.js";
import { extractToolCallFromWrapper } from "../../utils/xmlToolParser.js";
import { extractToolCallXMLParser } from "../../utils/xmlUtils.js";
import { detectPotentialToolCall } from "../toolCallHandler.js";

import type {
  OpenAITool,
  StreamProcessor,
  ExtractedToolCall,
  ToolCallDetectionResult,
} from "../../types/index.js";
import type { Response } from "express";
import type { Readable } from "stream";

// Wrapper tags to look for
const WRAPPER_START = '<toolbridge:calls>';
const WRAPPER_END = '</toolbridge:calls>';
const MAX_UNWRAPPED_BUFFER_SIZE = 5000; // Buffer size for unwrapped XML detection

export class WrapperAwareStreamProcessor implements StreamProcessor {
  public originalProcessor: StreamProcessor;
  public res?: Response | undefined;
  public buffer: string = "";
  public inWrapper: boolean = false;
  public wrapperContent: string = "";
  public beforeWrapperContent: string = "";
  public knownToolNames: string[] = [];
  public unwrappedBuffer: string = "";
  public checkingUnwrapped: boolean = false;

  constructor(originalProcessor: StreamProcessor) {
    this.originalProcessor = originalProcessor;
  this.res = originalProcessor.res ?? undefined;
    this.buffer = "";
    this.inWrapper = false;
    this.wrapperContent = "";
    this.beforeWrapperContent = "";
    this.knownToolNames = [];
    this.unwrappedBuffer = "";
    this.checkingUnwrapped = false;
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
    
    // If no wrapper detected, check for unwrapped XML
    if (!this.inWrapper && !this.buffer.includes(WRAPPER_START)) {
      this.processUnwrappedContent();
    }
  }

  private processUnwrappedContent(): void {
    // Add current buffer to unwrapped buffer
    this.unwrappedBuffer += this.buffer;
    this.buffer = "";
    
    logger.debug(`[TOOL DETECTOR] Checking content (${this.unwrappedBuffer.length} chars): ${this.unwrappedBuffer.substring(0, 100)}...`);
    
    // Check if we have potential unwrapped tool calls
  if (this.knownToolNames.length > 0) {
      const potential: ToolCallDetectionResult = detectPotentialToolCall(this.unwrappedBuffer, this.knownToolNames);
      
      if (potential.isPotential) {
        this.checkingUnwrapped = true;
        logger.debug(`[WRAPPER PROCESSOR] Detected potential unwrapped tool: ${potential.rootTagName}`);
        
        if (potential.isCompletedXml) {
          logger.debug("[WRAPPER PROCESSOR] Complete unwrapped XML detected, attempting extraction");
          this.processUnwrappedToolCall();
          return;
        }
        
        // Continue buffering if XML looks incomplete but promising
        if (this.unwrappedBuffer.length < MAX_UNWRAPPED_BUFFER_SIZE) {
          logger.debug("[WRAPPER PROCESSOR] Buffering incomplete unwrapped XML");
          return;
        }
      }
      
      // Also check if we can detect wrapper tags in the accumulated buffer
      const cleanBuffer = this.getCleanBufferForParsing(this.unwrappedBuffer);
  if (cleanBuffer.includes(WRAPPER_START) && cleanBuffer.includes(WRAPPER_END)) {
        logger.debug("[WRAPPER PROCESSOR] Found complete wrapper tags in unwrapped buffer!");
        
        // Extract the wrapped content and process it
  const toolCall: ExtractedToolCall | null = extractToolCallFromWrapper(this.unwrappedBuffer, this.knownToolNames);
  if (toolCall?.name) {
          logger.debug(`[WRAPPER PROCESSOR] Valid tool call found in unwrapped buffer: ${toolCall.name}`);
          
          // Send tool call chunks
          const functionCallChunks = createFunctionCallStreamChunks(
            toolCall,
            null, // id will be generated
            null  // model will be added later
          );
          
          const res = this.res;
          functionCallChunks.forEach((chunk) => {
            const sseString = formatSSEChunk(chunk);
            if (res) { res.write(sseString); }
          });
          
          // Send [DONE] signal
            if (this.res) {
            this.res.write("data: [DONE]\n\n");
            if (typeof this.originalProcessor.end === 'function') {
              this.originalProcessor.end();
            }
          }
          
          // Reset state
          this.unwrappedBuffer = "";
          this.checkingUnwrapped = false;
          return;
        }
      }
    }
    
  // If buffer is getting too large or no potential tool detected, flush as regular content
  if (this.unwrappedBuffer.length > MAX_UNWRAPPED_BUFFER_SIZE || (!this.checkingUnwrapped && this.unwrappedBuffer.length > 500)) {
      this.flushUnwrappedAsText();
    }
  }
  
  private getCleanBufferForParsing(buffer?: string): string {
  let cleanBuffer = buffer ?? this.buffer;
    
    // Remove thinking tags only for parsing check
    if (cleanBuffer.includes('◁think▷') && cleanBuffer.includes('◁/think▷')) {
      cleanBuffer = cleanBuffer.replace(/◁think▷[\s\S]*?◁\/think▷/g, '');
    }
    if (cleanBuffer.includes('<thinking>') && cleanBuffer.includes('</thinking>')) {
      cleanBuffer = cleanBuffer.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    }
    
    return cleanBuffer;
  }

  private processUnwrappedToolCall(): void {
    logger.debug("[WRAPPER PROCESSOR] Processing unwrapped tool call");
    
    // Try to extract tool call from unwrapped XML
    const toolCall: ExtractedToolCall | null = extractToolCallXMLParser(this.unwrappedBuffer, this.knownToolNames);
    
  if (toolCall?.name) {
      logger.debug(`[WRAPPER PROCESSOR] Valid unwrapped tool call found: ${toolCall.name}`);
      
      // Send tool call chunks
      const functionCallChunks = createFunctionCallStreamChunks(
        toolCall,
        null, // id will be generated
        null  // model will be added later
      );
      
      functionCallChunks.forEach(chunk => {
        const sseString = formatSSEChunk(chunk);
        if (this.res) {
          this.res.write(sseString);
        }
      });
      
      // Send [DONE] signal
      if (this.res) {
        this.res.write("data: [DONE]\n\n");
        if (typeof this.originalProcessor.end === 'function') {
          this.originalProcessor.end();
        }
      }
    } else {
      logger.debug("[WRAPPER PROCESSOR] Failed to extract unwrapped tool call, flushing as text");
      this.flushUnwrappedAsText();
    }
    
    // Reset unwrapped state
    this.unwrappedBuffer = "";
    this.checkingUnwrapped = false;
  }

  private flushUnwrappedAsText(): void {
    if (this.unwrappedBuffer.length > 0) {
      logger.debug("[WRAPPER PROCESSOR] Flushing unwrapped buffer as regular text");
      this.sendTextContent(this.unwrappedBuffer);
      this.unwrappedBuffer = "";
      this.checkingUnwrapped = false;
    }
  }

  private checkForCompleteWrapper(): boolean {
    // Use clean buffer for checking wrapper tags (strips thinking tags)
    const cleanBuffer = this.getCleanBufferForParsing();
    const startIndex = cleanBuffer.indexOf(WRAPPER_START);
    
    // No wrapper start found
    if (startIndex === -1) {
      return false;
    }
    
    // Found wrapper start, look for end
    const endIndex = cleanBuffer.indexOf(WRAPPER_END, startIndex);
    
    if (endIndex === -1) {
      // Start found but no end yet, enter buffering mode
      this.inWrapper = true;
      
      // Save content before wrapper (from original buffer, preserving thinking)
      if (startIndex > 0) {
        this.beforeWrapperContent = this.buffer.substring(0, startIndex);
        this.sendTextContent(this.beforeWrapperContent);
      }
      
      // Buffer from wrapper start
      this.wrapperContent = this.buffer.substring(startIndex);
      this.buffer = "";
      return false;
    }
    
    // Complete wrapper found!
    const wrapperEndPos = endIndex + WRAPPER_END.length;
    
    // Extract content before wrapper
    if (startIndex > 0) {
      const beforeContent = this.buffer.substring(0, startIndex);
      this.sendTextContent(beforeContent);
    }
    
    // Extract wrapped content
    const wrappedContent = this.buffer.substring(startIndex, wrapperEndPos);
    this.wrapperContent = wrappedContent;
    
    // Keep remaining content in buffer
    this.buffer = this.buffer.substring(wrapperEndPos);
    
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
    this.originalProcessor.res?.write(sseString);
  }

  handleDone(): void {
    // Check if we have incomplete wrapper content
    if (this.inWrapper && this.wrapperContent) {
      logger.warn("[WRAPPER PROCESSOR] Stream ended with incomplete wrapper");
      // Send the incomplete content as regular text
      this.sendTextContent(this.wrapperContent);
    }
    
  // Check if we have unwrapped buffer content
  if (this.unwrappedBuffer.length > 0) {
      logger.debug("[WRAPPER PROCESSOR] Stream ended, checking unwrapped buffer for tool calls");
      
      if (this.checkingUnwrapped && this.knownToolNames.length > 0) {
        const toolCall: ExtractedToolCall | null = extractToolCallXMLParser(this.unwrappedBuffer, this.knownToolNames);
        if (toolCall?.name) {
          logger.debug(`[WRAPPER PROCESSOR] Final unwrapped tool call found: ${toolCall.name}`);
          this.processUnwrappedToolCall();
          return; // Don't call original processor's handleDone if we processed a tool call
        }
      }
      
  // Flush remaining unwrapped content as text
  this.flushUnwrappedAsText();
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