# Server Layer - Agent Work Log

**Purpose**: Tracks autonomous agent refactoring work on server middleware and proxies.

**Parent**: See `/AGENTS.md` for project-wide principles and overall status.

---

## 🎯 Module Responsibility

The server layer provides:
- Generic proxy middleware
- Ollama-specific proxy middleware
- Request routing
- Backend forwarding

**SSOT Principles**:
- All proxy utilities route through `/src/utils/http/proxyUtils.ts`
- All proxy logging routes through `/src/utils/http/proxyLogging.ts`
- No duplicate proxy logic between `genericProxy.ts` and `ollamaProxy.ts`

---

## Session: Proxy Utilities Consolidation (2025-01-08)

**Objective**: Eliminate duplicate utility code between `genericProxy.ts` and `ollamaProxy.ts`.

### Problem

**Before**: 4 code blocks duplicated between `genericProxy.ts` and `ollamaProxy.ts`

```typescript
// genericProxy.ts (DUPLICATE 1)
interface ProxyResponse extends IncomingMessage {
  statusCode?: number;
}

function getOriginalUrl(req) { /* ... */ }
function collectBackendHeaders(req, auth) { /* ... */ }
function buildProxyRequestInfo(req, url, auth) { /* ... */ }

// ollamaProxy.ts (DUPLICATE 2 - same code!)
interface ProxyResponse extends IncomingMessage {
  statusCode?: number;
}

function getOriginalUrl(req) { /* ... */ }
function collectBackendHeaders(req, auth) { /* ... */ }
function buildProxyRequestInfo(req, url, auth) { /* ... */ }
```

**Violations**:
- ❌ 30 lines of duplicate code
- ❌ DRY principle violated
- ❌ Changes must be applied twice

### Solution

Created `/src/utils/http/proxyUtils.ts` as SSOT:

```typescript
// proxyUtils.ts - SINGLE SOURCE OF TRUTH
export interface ProxyResponse extends IncomingMessage {
  statusCode?: number;
}

export function getOriginalUrl(req: IncomingMessage): string { /* ... */ }
export function collectBackendHeaders(req: IncomingMessage, auth?: string): HeadersInit { /* ... */ }
export function buildProxyRequestInfo(req: IncomingMessage, url: string, auth?: string): ProxyRequest { /* ... */ }
```

Both proxies now import from SSOT:

```typescript
// genericProxy.ts
import { getOriginalUrl, collectBackendHeaders, buildProxyRequestInfo } from '../utils/http/proxyUtils.js';

// ollamaProxy.ts
import { getOriginalUrl, collectBackendHeaders, buildProxyRequestInfo } from '../utils/http/proxyUtils.js';
```

### Impact

- ✅ Eliminated 1 clone (4 duplicate blocks consolidated)
- ✅ Removed 30 lines of duplicate code
- ✅ Single source for proxy middleware operations
- ✅ Code duplication: 2.75% → 2.67% (-3%)

---

## Usage Guidelines

### Generic Proxy

**File**: `genericProxy.ts`

The generic proxy forwards requests to any backend:

```typescript
import { genericProxy } from './server/genericProxy.js';

// Create proxy middleware
const proxy = genericProxy(backendUrl, options);

// Use in server
server.on('request', proxy);
```

### Ollama Proxy

**File**: `ollamaProxy.ts`

The Ollama proxy handles Ollama-specific endpoints:

```typescript
import { ollamaProxy } from './server/ollamaProxy.js';

// Create Ollama proxy middleware
const proxy = ollamaProxy(ollamaBackendUrl, options);

// Use in server
server.on('request', proxy);
```

### Using Proxy Utilities

See `/src/utils/http/AGENTS.md` for detailed documentation on:
- `getOriginalUrl()` - Extract original URL from request
- `collectBackendHeaders()` - Collect proxy request headers
- `buildProxyRequestInfo()` - Build ProxyRequest info for logging

---

## Best Practices

### DO

✅ **Import proxy utilities from `/src/utils/http/proxyUtils.ts`**:
```typescript
import { getOriginalUrl, collectBackendHeaders } from '../utils/http/proxyUtils.js';
```

✅ **Use consistent proxy patterns**:
```typescript
const originalUrl = getOriginalUrl(req);
const headers = collectBackendHeaders(req, authHeader);
const proxyInfo = buildProxyRequestInfo(req, originalUrl, authHeader);
```

### DON'T

❌ **Don't re-implement proxy utilities**:
```typescript
// WRONG - creates duplication
function getOriginalUrl(req) { /* custom implementation */ }

// RIGHT - use SSOT
import { getOriginalUrl } from '../utils/http/proxyUtils.js';
```

❌ **Don't duplicate proxy logic between files**:
```typescript
// WRONG - copy/paste between genericProxy and ollamaProxy
// RIGHT - extract to proxyUtils and import
```

---

**Status**: ✅ **COMPLETE** - Proxy Utilities Consolidation

**Last Updated**: 2025-01-08
**Files Modified**: 2 (`genericProxy.ts`, `ollamaProxy.ts`)
**Duplicate Lines Removed**: 30
**Utilities Created**: 1 (`/src/utils/http/proxyUtils.ts`)
**DRY Violations Fixed**: 1 category (proxy utilities)

---

**See Also**:
- `/src/utils/http/AGENTS.md` - Detailed proxy utilities documentation
