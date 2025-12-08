# HTTP Utilities - Agent Work Log

**Purpose**: Tracks autonomous agent refactoring work on HTTP utilities (handlers, proxies, error handling, logging).

**Parent**: See `/AGENTS.md` for project-wide principles and overall status.

---

## 🎯 Module Responsibility

The HTTP utilities layer provides:
- Handler utilities (auth, logging, responses)
- Proxy utilities (URL extraction, header collection, request info)
- Error response handling
- Proxy logging
- SSE utilities
- General HTTP helpers

**SSOT Principles**:
- All handler operations route through `handlerUtils.ts`
- All proxy operations route through `proxyUtils.ts`
- All error responses route through `errorResponseHandler.ts`
- All proxy logging routes through `proxyLogging.ts`

---

## Session: HTTP Utilities Consolidation (2025-01-08)

**Objective**: Eliminate duplicate HTTP utility patterns across handlers and proxies.

### Fix 1: Proxy Utilities Consolidation

**Problem**: 4 code blocks duplicated between `genericProxy.ts` and `ollamaProxy.ts`
- ProxyResponse type definition
- Original URL extraction
- Backend header collection
- Proxy request info construction

**Solution**: Created `src/utils/http/proxyUtils.ts` as SSOT

**Files Created**:
- `proxyUtils.ts` (62 lines)
  - `ProxyResponse` interface
  - `getOriginalUrl()` - Extract original URL from request
  - `collectBackendHeaders()` - Collect proxy request headers
  - `buildProxyRequestInfo()` - Build ProxyRequest info for logging

**Files Updated**:
- `src/server/genericProxy.ts` (eliminated 15 lines)
- `src/server/ollamaProxy.ts` (eliminated 15 lines)

**Impact**:
- ✅ Eliminated 1 clone (4 duplicate blocks consolidated)
- ✅ Removed 30 lines of duplicate code
- ✅ Single source for proxy middleware operations

### Fix 2: Handler Utilities Consolidation

**Problem**: 6 code blocks duplicated across 4 handler files
- Auth header extraction pattern (4 occurrences)
- Debug logging pattern (4 occurrences)
- JSON response sending with debug (4 occurrences)

**Solution**: Created `src/utils/http/handlerUtils.ts` as SSOT

**Files Created**:
- `handlerUtils.ts` (58 lines)
  - `extractAuthHeader()` - Extract authorization header from request
  - `logDebugResponse()` - Conditional debug logging
  - `sendSuccessJSON()` - Send JSON response with optional debug logging
  - `getBackendContext()` - Get backend mode + auth header

**Files Updated**:
- `src/handlers/openaiModelInfoHandler.ts` (eliminated 8 lines)
- `src/handlers/openaiModelsHandler.ts` (eliminated 8 lines)
- `src/handlers/ollamaShowHandler.ts` (eliminated 6 lines)
- `src/handlers/ollamaTagsHandler.ts` (eliminated 6 lines)

**Impact**:
- ✅ Eliminated 2 clones (6 duplicate blocks consolidated)
- ✅ Removed 28 lines of duplicate code
- ✅ Single source for handler operations

### SSOT/DRY/KISS Compliance

**SSOT**: ✅
- Proxy operations: Single source (`proxyUtils.ts`)
- Handler operations: Single source (`handlerUtils.ts`)
- No competing implementations

**DRY**: ✅
- Eliminated 58 lines of duplicate code total
- 3 clones eliminated
- Code duplication: 2.75% → 2.56% (-7%)

**KISS**: ✅
- Simple, focused utility files
- Clear single responsibilities
- No over-engineering

---

## Available Utilities

### Proxy Utilities

**File**: `proxyUtils.ts` (62 lines)

```typescript
import {
  ProxyResponse,
  getOriginalUrl,
  collectBackendHeaders,
  buildProxyRequestInfo
} from '../../utils/http/proxyUtils.js';

// Get original URL from proxied request
const originalUrl = getOriginalUrl(req);

// Collect headers for backend request
const headers = collectBackendHeaders(req, authHeader);

// Build proxy request info for logging
const proxyInfo = buildProxyRequestInfo(req, originalUrl, authHeader);
```

### Handler Utilities

**File**: `handlerUtils.ts` (58 lines)

```typescript
import {
  extractAuthHeader,
  logDebugResponse,
  sendSuccessJSON,
  getBackendContext
} from '../../utils/http/handlerUtils.js';

// Extract auth header from request
const authHeader = extractAuthHeader(req);

// Conditionally log debug information
logDebugResponse('Model info response', responseData);

// Send JSON response with optional debug logging
await sendSuccessJSON(res, responseData, 'Model info response');

// Get backend context (mode + auth)
const { backendMode, authHeader } = getBackendContext(req);
```

### Error Response Handling

**File**: `errorResponseHandler.ts`

```typescript
import { sendErrorResponse } from '../../utils/http/errorResponseHandler.js';

// Send standardized error response
sendErrorResponse(res, 404, 'Resource not found');
sendErrorResponse(res, 500, 'Internal server error', error);
```

### Proxy Logging

**File**: `proxyLogging.ts`

```typescript
import { logProxyRequest, logProxyResponse } from '../../utils/http/proxyLogging.js';

// Log proxy request
logProxyRequest(req, backend, originalUrl);

// Log proxy response
logProxyResponse(res, backend, duration);
```

### SSE Utilities

**File**: `sseUtils.ts`

```typescript
import { formatSSEChunk, sendSSEChunk } from '../../utils/http/sseUtils.js';

// Format SSE chunk
const chunk = formatSSEChunk(data, eventName);

// Send SSE chunk to client
sendSSEChunk(res, data, eventName);
```

---

## Usage Guidelines

### Proxy Middleware Pattern

```typescript
import { getOriginalUrl, collectBackendHeaders, buildProxyRequestInfo } from '../../utils/http/proxyUtils.js';
import { logProxyRequest } from '../../utils/http/proxyLogging.js';

export function createProxy(backend: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const originalUrl = getOriginalUrl(req);
    const authHeader = req.headers.authorization;
    const headers = collectBackendHeaders(req, authHeader);
    const proxyInfo = buildProxyRequestInfo(req, originalUrl, authHeader);

    logProxyRequest(req, backend, originalUrl);

    // Forward request to backend
    const backendResponse = await fetch(backend + originalUrl, {
      method: req.method,
      headers,
      body: req.body
    });

    // Forward response to client
    res.writeHead(backendResponse.status, backendResponse.headers);
    backendResponse.body.pipe(res);
  };
}
```

### Handler Pattern

```typescript
import { extractAuthHeader, sendSuccessJSON, getBackendContext } from '../../utils/http/handlerUtils.js';

export async function handleModelInfo(req: IncomingMessage, res: ServerResponse) {
  const { backendMode, authHeader } = getBackendContext(req);

  // Fetch model info from backend
  const modelInfo = await fetchModelInfo(backendMode, authHeader);

  // Send success response with debug logging
  await sendSuccessJSON(res, modelInfo, 'Model info response');
}
```

---

## Best Practices

### DO

✅ **Always use centralized utilities**:
```typescript
// RIGHT - use SSOT
import { extractAuthHeader } from '../../utils/http/handlerUtils.js';
const auth = extractAuthHeader(req);
```

✅ **Use sendSuccessJSON for consistent responses**:
```typescript
// RIGHT - consistent response format
await sendSuccessJSON(res, data, 'Debug label');
```

✅ **Use proxy utilities for middleware**:
```typescript
// RIGHT - centralized proxy logic
const originalUrl = getOriginalUrl(req);
const headers = collectBackendHeaders(req, authHeader);
```

### DON'T

❌ **Don't re-implement auth header extraction**:
```typescript
// WRONG - duplicate logic
const authHeader = req.headers.authorization || req.headers.Authorization;

// RIGHT - use SSOT
const authHeader = extractAuthHeader(req);
```

❌ **Don't manually construct responses**:
```typescript
// WRONG - inconsistent format
res.writeHead(200, { 'Content-Type': 'application/json' });
res.end(JSON.stringify(data));

// RIGHT - use helper
await sendSuccessJSON(res, data);
```

❌ **Don't duplicate proxy logic**:
```typescript
// WRONG - duplicate URL extraction
const originalUrl = req.url?.replace('/proxy', '') || '/';

// RIGHT - use SSOT
const originalUrl = getOriginalUrl(req);
```

---

**Status**: ✅ **COMPLETE** - HTTP Utilities Consolidation

**Last Updated**: 2025-01-08
**Files Created**: 2 (`proxyUtils.ts`, `handlerUtils.ts`)
**Files Modified**: 6 (2 proxies, 4 handlers)
**Duplicate Lines Removed**: 58
**Code Duplication Reduction**: 2.75% → 2.56% (-7%)
**DRY Violations Fixed**: 2 categories
