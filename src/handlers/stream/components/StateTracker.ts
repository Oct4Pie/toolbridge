/**
 * StateTracker - Stream State Management Component
 *
 * SSOT Compliance: Single source of truth for streaming state.
 * Extracted from formatConvertingStreamProcessor to follow KISS principle.
 *
 * Purpose: Track streaming state (tool calls, content emission, flags).
 *
 * Responsibilities:
 * - Track tool call state (in progress, completed)
 * - Track content emission state
 * - Track chunk counts
 * - Provide state queries and updates
 *
 * KISS Compliance: <120 lines, single responsibility, simple state machine
 */

import { logger } from "../../../logging/index.js";

/**
 * Stream state snapshot
 */
export interface StreamState {
  /** Whether a tool call is currently in progress */
  isToolCallInProgress: boolean;
  /** Whether any content has been emitted */
  hasEmittedContent: boolean;
  /** Current tool call name if in progress */
  currentToolCall?: string;
  /** Total number of chunks processed */
  chunkCount: number;
  /** Whether stream has ended */
  streamEnded: boolean;
  /** Whether done signal has been sent */
  doneSent: boolean;
}

/**
 * StateTracker manages streaming state
 */
export class StateTracker {
  private state: StreamState;

  constructor() {
    this.state = {
      isToolCallInProgress: false,
      hasEmittedContent: false,
      chunkCount: 0,
      streamEnded: false,
      doneSent: false,
    };
  }

  /**
   * Mark tool call as started
   * @param toolName - Name of the tool being called
   */
  startToolCall(toolName: string): void {
    this.state.isToolCallInProgress = true;
    this.state.currentToolCall = toolName;

    logger.debug(`[STATE TRACKER] Tool call started: ${toolName}`);
  }

  /**
   * Mark tool call as ended
   */
  endToolCall(): void {
    const previousTool = this.state.currentToolCall;
    this.state.isToolCallInProgress = false;
    this.state.currentToolCall = undefined as any;

    logger.debug(`[STATE TRACKER] Tool call ended: ${previousTool}`);
  }

  /**
   * Record that a chunk was processed
   */
  recordChunk(): void {
    this.state.chunkCount++;
  }

  /**
   * Record that content was emitted
   */
  recordContent(): void {
    if (!this.state.hasEmittedContent) {
      this.state.hasEmittedContent = true;
      logger.debug("[STATE TRACKER] First content emitted");
    }
  }

  /**
   * Mark stream as ended
   */
  markStreamEnded(): void {
    this.state.streamEnded = true;
    logger.debug("[STATE TRACKER] Stream ended");
  }

  /**
   * Mark done signal as sent
   */
  markDoneSent(): void {
    this.state.doneSent = true;
    logger.debug("[STATE TRACKER] Done signal sent");
  }

  /**
   * Get current state (readonly)
   * @returns Immutable copy of current state
   */
  getState(): Readonly<StreamState> {
    return { ...this.state };
  }

  /**
   * Check if tool call is in progress
   */
  isToolCallActive(): boolean {
    return this.state.isToolCallInProgress;
  }

  /**
   * Check if any content has been emitted
   */
  hasContent(): boolean {
    return this.state.hasEmittedContent;
  }

  /**
   * Check if stream has ended
   */
  hasEnded(): boolean {
    return this.state.streamEnded;
  }

  /**
   * Check if done signal was sent
   */
  isDoneSent(): boolean {
    return this.state.doneSent;
  }

  /**
   * Reset state (for reuse or testing)
   */
  reset(): void {
    logger.debug("[STATE TRACKER] Resetting state");

    this.state = {
      isToolCallInProgress: false,
      hasEmittedContent: false,
      chunkCount: 0,
      streamEnded: false,
      doneSent: false,
    };
  }
}
