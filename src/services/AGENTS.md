# Services Layer - Agent Work Log

**Purpose**: Tracks autonomous agent refactoring work on the services layer.

**Parent**: See `/AGENTS.md` for project-wide principles and overall status.

---

## 🎯 Module Responsibility

The services layer handles:
- Format detection (request/response format identification)
- Model information and capabilities
- Configuration management
- Backend service coordination

**SSOT Principles**:
- All format detection routes through `formatDetectionService.ts`
- All model information routes through `modelService.ts`
- All configuration routes through `configService.ts`

---

## Session: Format Detection Consolidation (2025-01-05)

**Objective**: Fix SSOT violation where two competing format detection implementations existed with different logic.

### Problem

**Before**: Two competing implementations with different detection orders:

```typescript
// formatDetector.ts (DEPRECATED)
detectRequestFormat(req) {
  // 1. Header
  // 2. Body
  // 3. Default
  // ❌ MISSING: URL-based detection
}

// formatDetectionService.ts (SSOT)
detectRequestFormat(body, headers, url) {
  // 1. URL (most reliable) ← MISSING in formatDetector!
  // 2. Header
  // 3. Body
  // 4. Default
}
```

**Result**: Ollama `/api/chat` requests misdetected as OpenAI, breaking tool calls.

### Solution

Single SSOT implementation in `formatDetectionService.ts`:

```typescript
class FormatDetectionServiceImpl implements FormatDetectionService {
  detectRequestFormat(body, headers, url?) {
    // 1. URL-based detection (MOST RELIABLE)
    if (url.includes('/api/chat') || url.includes('/api/generate')) {
      return FORMAT_OLLAMA; // ✅ Correctly detect Ollama
    }
    if (url.includes('/v1/')) {
      return FORMAT_OPENAI; // ✅ Correctly detect OpenAI
    }

    // 2. Header-based detection
    const explicitFormat = headers['x-api-format'];
    if (explicitFormat === FORMAT_OLLAMA) return FORMAT_OLLAMA;
    if (explicitFormat === FORMAT_OPENAI) return FORMAT_OPENAI;

    // 3. Body-based detection
    if (isOllamaFormat(body)) return FORMAT_OLLAMA;
    if (isOpenAIFormat(body)) return FORMAT_OPENAI;

    // 4. Default fallback
    return FORMAT_OPENAI;
  }

  detectResponseFormat(response) {
    // Similar consolidation for response detection
  }
}
```

### Changes

1. Moved complete detection logic to `formatDetectionService.ts`
2. Added URL-based detection (highest priority)
3. Deprecated `formatDetector.ts` with clear migration notices
4. Kept FORMAT constants for backward compatibility

### Impact

- ✅ Fixed Ollama endpoint misdetection
- ✅ URL patterns correctly identify Ollama `/api/*` endpoints
- ✅ URL patterns correctly identify OpenAI `/v1/*` endpoints
- ✅ Single source of truth for all detection
- ✅ Backward compatible (no breaking changes)

### SSOT/DRY/KISS Compliance

**SSOT**: ✅ Consolidated 2 implementations → 1 SSOT

**DRY**: ✅ No duplicate detection logic

**KISS**: ✅ Clear detection priority order

---

## Usage Guidelines

### Format Detection

**Detecting Request Format**:
```typescript
import { formatDetectionService } from '../services/formatDetectionService.js';

const format = formatDetectionService.detectRequestFormat(
  requestBody,
  requestHeaders,
  requestUrl  // Optional but recommended
);

if (format === 'ollama') {
  // Handle Ollama format
} else {
  // Handle OpenAI format
}
```

**Detecting Response Format**:
```typescript
import { formatDetectionService } from '../services/formatDetectionService.js';

const format = formatDetectionService.detectResponseFormat(responseObject);
```

**Detection Priority**:
1. **URL patterns** (most reliable):
   - `/api/chat`, `/api/generate` → Ollama
   - `/v1/*` → OpenAI
2. **Headers**: `x-api-format` header
3. **Body structure**: Ollama vs OpenAI format detection
4. **Default**: OpenAI (most common)

---

## Best Practices

### DO

✅ **Always pass URL for request detection**:
```typescript
// BEST - includes URL for accurate detection
const format = formatDetectionService.detectRequestFormat(
  body,
  headers,
  req.url  // Include URL!
);
```

✅ **Use explicit format header when possible**:
```typescript
// Client sends explicit format
headers['x-api-format'] = 'ollama';
```

### DON'T

❌ **Don't import from deprecated `formatDetector.ts`**:
```typescript
// WRONG - deprecated
import { detectRequestFormat } from '../handlers/formatDetector.js';

// RIGHT - use service
import { formatDetectionService } from '../services/formatDetectionService.js';
```

❌ **Don't skip URL parameter**:
```typescript
// WRONG - less accurate
const format = formatDetectionService.detectRequestFormat(body, headers);

// RIGHT - most accurate
const format = formatDetectionService.detectRequestFormat(body, headers, url);
```

---

**Status**: ✅ **COMPLETE** - Format Detection Consolidation

**Last Updated**: 2025-01-05
**SSOT Violations Fixed**: 1 (format detection)
**Critical Bugs Fixed**: 1 (Ollama endpoint misdetection)
