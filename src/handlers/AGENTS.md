# Handlers - Agent Work Log

**Purpose**: Tracks autonomous agent refactoring work on request handlers.

**Parent**: See `/AGENTS.md` for project-wide principles and overall status.

---

## 🎯 Module Responsibility

The handlers layer provides:
- OpenAI endpoint handlers (`/v1/models`, `/v1/chat/completions`, etc.)
- Ollama endpoint handlers (`/api/tags`, `/api/show`, `/api/chat`, etc.)
- Streaming handlers
- Non-streaming handlers
- Tool call handlers

**SSOT Principles**:
- All handler utilities route through `/src/utils/http/handlerUtils.ts`
- All format detection routes through `/src/services/formatDetectionService.ts`
- All tool call detection routes through `/src/parsers/xml/utils/toolCallDetection.ts`

---

## Session: Handler Utilities Consolidation (2025-01-08)

**Objective**: Eliminate duplicate utility patterns across handler files.

### Problem

**Before**: 6 code blocks duplicated across 4 handler files

```typescript
// openaiModelInfoHandler.ts (DUPLICATE 1)
function extractAuthHeader(req) {
  return req.headers.authorization || req.headers.Authorization;
}

function logDebugResponse(label, data) {
  if (process.env.DEBUG) {
    console.log(`[${label}]`, JSON.stringify(data, null, 2));
  }
}

function sendSuccessJSON(res, data, debugLabel) {
  if (debugLabel) logDebugResponse(debugLabel, data);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// openaiModelsHandler.ts (DUPLICATE 2 - same code!)
function extractAuthHeader(req) { /* ... */ }
function logDebugResponse(label, data) { /* ... */ }
function sendSuccessJSON(res, data, debugLabel) { /* ... */ }

// ... duplicated in 2 more files
```

**Violations**:
- ❌ 28 lines of duplicate code
- ❌ DRY principle violated
- ❌ Inconsistent error handling

### Solution

Created `/src/utils/http/handlerUtils.ts` as SSOT:

```typescript
// handlerUtils.ts - SINGLE SOURCE OF TRUTH
export function extractAuthHeader(req: IncomingMessage): string | undefined {
  return req.headers.authorization || (req.headers as any).Authorization;
}

export function logDebugResponse(label: string, data: unknown): void {
  if (process.env.DEBUG) {
    console.log(`[${label}]`, JSON.stringify(data, null, 2));
  }
}

export async function sendSuccessJSON(
  res: ServerResponse,
  data: unknown,
  debugLabel?: string
): Promise<void> {
  if (debugLabel) logDebugResponse(debugLabel, data);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function getBackendContext(req: IncomingMessage): {
  backendMode: string;
  authHeader?: string;
} {
  const authHeader = extractAuthHeader(req);
  const backendMode = process.env.BACKEND_MODE || 'ollama';
  return { backendMode, authHeader };
}
```

All handlers now import from SSOT:

```typescript
// openaiModelInfoHandler.ts
import { extractAuthHeader, sendSuccessJSON, getBackendContext } from '../utils/http/handlerUtils.js';

// openaiModelsHandler.ts
import { extractAuthHeader, sendSuccessJSON, getBackendContext } from '../utils/http/handlerUtils.js';

// ollamaShowHandler.ts
import { extractAuthHeader, sendSuccessJSON, getBackendContext } from '../utils/http/handlerUtils.js';

// ollamaTagsHandler.ts
import { extractAuthHeader, sendSuccessJSON, getBackendContext } from '../utils/http/handlerUtils.js';
```

### Impact

- ✅ Eliminated 2 clones (6 duplicate blocks consolidated)
- ✅ Removed 28 lines of duplicate code
- ✅ Single source for handler operations
- ✅ Code duplication: 2.67% → 2.56% (-4%)

---

## Usage Guidelines

### Handler Pattern

**Standard Handler Structure**:

```typescript
import { getBackendContext, sendSuccessJSON } from '../utils/http/handlerUtils.js';
import { formatDetectionService } from '../services/formatDetectionService.js';

export async function handleEndpoint(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // 1. Get backend context (auth + mode)
  const { backendMode, authHeader } = getBackendContext(req);

  // 2. Detect format if needed
  const format = formatDetectionService.detectRequestFormat(
    req.body,
    req.headers,
    req.url
  );

  // 3. Fetch data from backend
  const data = await fetchFromBackend(backendMode, authHeader);

  // 4. Transform if needed
  const transformed = transformData(data, format);

  // 5. Send response with debug logging
  await sendSuccessJSON(res, transformed, 'Endpoint response');
}
```

### Using Handler Utilities

See `/src/utils/http/AGENTS.md` for detailed documentation on:
- `extractAuthHeader()` - Extract authorization header
- `logDebugResponse()` - Conditional debug logging
- `sendSuccessJSON()` - Send JSON response with debug
- `getBackendContext()` - Get backend mode + auth

---

## Handler Types

### OpenAI Handlers

**Model Information**:
- `openaiModelInfoHandler.ts` - Single model info (`/v1/models/:id`)
- `openaiModelsHandler.ts` - List models (`/v1/models`)

**Completions**:
- `chatHandler.ts` - Chat completions (`/v1/chat/completions`)

### Ollama Handlers

**Model Information**:
- `ollamaTagsHandler.ts` - List models (`/api/tags`)
- `ollamaShowHandler.ts` - Model details (`/api/show`)

**Completions**:
- `ollamaGenerateHandler.ts` - Generate (`/api/generate`)

**Version**:
- `ollamaVersionHandler.ts` - Version info (`/api/version`)

### Streaming Handlers

See `/src/handlers/stream/AGENTS.md` for detailed documentation on:
- `streamingHandler.ts` - Streaming request coordinator
- `formatConvertingStreamProcessor.ts` - Bidirectional streaming converter
- `openaiStreamProcessor.ts` - OpenAI SSE streaming
- `ollamaStreamProcessor.ts` - Ollama NDJSON streaming

### Tool Call Handler

- `toolCallHandler.ts` - Tool call detection (re-exports from `/src/parsers/xml/`)

---

## Best Practices

### DO

✅ **Import handler utilities from `/src/utils/http/handlerUtils.ts`**:
```typescript
import { getBackendContext, sendSuccessJSON } from '../utils/http/handlerUtils.js';
```

✅ **Use consistent handler patterns**:
```typescript
const { backendMode, authHeader } = getBackendContext(req);
const data = await fetchData(backendMode, authHeader);
await sendSuccessJSON(res, data, 'Debug label');
```

✅ **Use format detection service for format-dependent logic**:
```typescript
import { formatDetectionService } from '../services/formatDetectionService.js';
const format = formatDetectionService.detectRequestFormat(body, headers, url);
```

### DON'T

❌ **Don't re-implement handler utilities**:
```typescript
// WRONG - creates duplication
function extractAuthHeader(req) { /* custom implementation */ }

// RIGHT - use SSOT
import { extractAuthHeader } from '../utils/http/handlerUtils.js';
```

❌ **Don't manually send responses**:
```typescript
// WRONG - inconsistent format
res.writeHead(200, { 'Content-Type': 'application/json' });
res.end(JSON.stringify(data));

// RIGHT - use helper
await sendSuccessJSON(res, data);
```

❌ **Don't duplicate auth extraction**:
```typescript
// WRONG - duplicate logic
const auth = req.headers.authorization || req.headers.Authorization;

// RIGHT - use SSOT
const auth = extractAuthHeader(req);
```

---

**Status**: ✅ **COMPLETE** - Handler Utilities Consolidation

**Last Updated**: 2025-01-08
**Files Modified**: 4 handler files
**Duplicate Lines Removed**: 28
**Utilities Created**: 1 (`/src/utils/http/handlerUtils.ts`)
**DRY Violations Fixed**: 1 category (handler utilities)

---

**See Also**:
- `/src/utils/http/AGENTS.md` - Detailed handler utilities documentation
- `/src/handlers/stream/AGENTS.md` - Streaming handlers documentation
- `/src/services/AGENTS.md` - Format detection service documentation
- `/src/parsers/xml/AGENTS.md` - Tool call detection documentation
