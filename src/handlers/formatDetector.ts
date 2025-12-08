/**
 * Format Detector - DEPRECATED (Constants Only)
 *
 * @deprecated This module is DEPRECATED. Use formatDetectionService instead.
 *
 * This file contains ONLY constant exports for backward compatibility.
 * DO NOT add executable code here. All detection logic lives in
 * src/services/formatDetectionService.ts (SSOT).
 *
 * Migration Guide:
 * ------------------------------------------------------------------
 * OLD (deprecated):
 *   import { detectRequestFormat } from './formatDetector.js'
 *   const format = detectRequestFormat(req);
 *
 * NEW (use SSOT):
 *   import { formatDetectionService } from '../services/formatDetectionService.js'
 *   const format = formatDetectionService.detectRequestFormat(
 *     req.body,
 *     req.headers,
 *     req.url
 *   );
 * ------------------------------------------------------------------
 *
 * Why this file exists:
 * - Backward compatibility for code that imports FORMAT_* constants
 * - Prevents breaking changes during refactoring
 * - Will be removed in v2.0.0
 *
 * SSOT Location:
 * - Format detection: src/services/formatDetectionService.ts
 * - Format constants: src/translation/types/providers.ts
 */

import type { RequestFormat } from "../types/index.js";

// Re-export format constants for backward compatibility
// SOURCE OF TRUTH: src/translation/types/providers.ts
export const FORMAT_OPENAI: RequestFormat = "openai";
export const FORMAT_OLLAMA: RequestFormat = "ollama";
export const FORMAT_UNKNOWN = "unknown";

/**
 * @deprecated Marker constant indicating this file is deprecated.
 * If you're reading this in code, you should migrate to formatDetectionService.
 */
export const DEPRECATED_NOTICE =
  'formatDetector.ts is deprecated. Use formatDetectionService from services layer.';

// ═══════════════════════════════════════════════════════════════════
// NO EXECUTABLE CODE BEYOND THIS POINT
// ═══════════════════════════════════════════════════════════════════
//
// All detection logic has been moved to:
// - src/services/formatDetectionService.ts (SSOT)
//
// ESLint enforces this via no-restricted-syntax rule.
// If you need detection logic, use formatDetectionService.
// ═══════════════════════════════════════════════════════════════════