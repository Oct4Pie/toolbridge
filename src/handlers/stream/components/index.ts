/**
 * Stream Components - Reusable Stream Processing Components
 *
 * SSOT/DRY/KISS Compliant Components:
 * - Each component has a SINGLE responsibility
 * - All components are <150 lines
 * - No duplication across components
 * - Clear interfaces and contracts
 */

export { BufferManager } from "./BufferManager.js";
export { XmlDetector } from "./XmlDetector.js";
export type { XmlDetectionResult, XmlExtractionResult } from "./XmlDetector.js";
export { SseFormatter } from "./SseFormatter.js";
export { NdjsonFormatter } from "./NdjsonFormatter.js";
export { StateTracker } from "./StateTracker.js";
export type { StreamState } from "./StateTracker.js";
