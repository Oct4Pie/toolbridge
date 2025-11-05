# Bug Fix: Double Done Signal (OpenAI → Ollama)

**Date**: 2025-01-05
**Priority**: 🐛 **HIGH** - Causes duplicate done signals
**Status**: ✅ **FIXED AND VERIFIED**

---

## 🐛 Bug Description

When converting OpenAI format to Ollama format, if a tool call was being buffered when the `[DONE]` signal arrived, the proxy was sending **TWO** `done: true` messages to the client.

### Affected Flow
**OpenAI → Ollama with tool call at stream end**

---

## 🔍 Root Cause

**Location**: `src/handlers/stream/formatConvertingStreamProcessor.ts:141-164`

### The Buggy Code

```typescript
if (data === "[DONE]") {
  if (this.isPotentialToolCall && this.toolCallBuffer) {
    logger.debug(
      "[STREAM PROCESSOR] FC: Received [DONE] while buffering potential tool call.",
    );
    this.handleEndOfStreamWhileBufferingXML();  // ← Sends done: true
  }

  // BUG: After calling handleEndOfStreamWhileBufferingXML() above,
  // isPotentialToolCall is now FALSE (because state was reset)
  if (!this.isPotentialToolCall) {  // ← This is now TRUE!
    this.res.write(
      JSON.stringify({
        model: this.model ?? "unknown-model",
        created_at: new Date().toISOString(),
        response: "",
        done: true,  // ← Sends done: true AGAIN! ❌
      }) + "\n",
    );
  }
  this.end();
  return;
}
```

### Why It Happened

1. **Line 146**: Calls `handleEndOfStreamWhileBufferingXML()`
2. **That function** (line 395-403): Handles tool call and sends `done: true` message
3. **That function** (line 394 → 361 → 559): Calls `resetToolCallState()` which sets `isPotentialToolCall = false`
4. **Back at line 149**: `if (!this.isPotentialToolCall)` is now TRUE (because state was reset!)
5. **Line 154-161**: Sends `done: true` message **AGAIN!** ❌
6. **Result**: Client receives TWO done messages

### The Sequence

```
1. Backend sends [DONE] while buffering tool call
2. Call handleEndOfStreamWhileBufferingXML()
   → Handles tool call
   → Sends done: true  ✓
   → Resets state (isPotentialToolCall = false)
3. Back in [DONE] handler
4. Check: if (!isPotentialToolCall) → TRUE!
5. Send done: true AGAIN  ❌
6. Client gets duplicate done signals
```

---

## ✅ Solution

After calling `handleEndOfStreamWhileBufferingXML()`, **return early** instead of continuing to the second `done: true` check.

### The Fix

```typescript
if (data === "[DONE]") {
  if (this.isPotentialToolCall && this.toolCallBuffer) {
    logger.debug(
      "[STREAM PROCESSOR] FC: Received [DONE] while buffering potential tool call.",
    );
    this.handleEndOfStreamWhileBufferingXML();
    // handleEndOfStreamWhileBufferingXML() sends done: true, so return early
    // to avoid sending done: true again below
    this.end();
    return;  // ← FIX: Return early!
  }

  // Only reached if we weren't buffering a tool call
  this.res.write(
    JSON.stringify({
      model: this.model ?? "unknown-model",
      created_at: new Date().toISOString(),
      response: "",
      done: true,
    }) + "\n",
  );
  this.end();
  return;
}
```

### Key Changes

- ✅ Added early return after `handleEndOfStreamWhileBufferingXML()` (line 149-150)
- ✅ Removed the `if (!this.isPotentialToolCall)` check that was causing the bug
- ✅ Added clear comment explaining why we return early
- ✅ Restructured logic so second `done: true` only sent if NOT buffering tool call

---

## 🔄 Correct Flow (After Fix)

### Scenario: [DONE] While Buffering Tool Call

```
1. Backend sends [DONE] while buffering tool call
2. Check: if (this.isPotentialToolCall && this.toolCallBuffer) → TRUE
3. Call handleEndOfStreamWhileBufferingXML()
   → Handles tool call
   → Sends done: true ✓
   → Resets state
4. Call this.end()
5. RETURN EARLY ✓
6. Second done: true check NEVER REACHED ✓
7. Client gets ONE done signal ✓
```

### Scenario: [DONE] With No Tool Call

```
1. Backend sends [DONE], not buffering tool call
2. Check: if (this.isPotentialToolCall && this.toolCallBuffer) → FALSE
3. Skip to line 154
4. Send done: true ✓
5. Call this.end()
6. Return
7. Client gets ONE done signal ✓
```

---

## 📊 Impact

### Before Fix
- 🔴 Two `done: true` messages sent to client
- 🔴 Client confused by duplicate completion signals
- 🔴 Potential client-side errors or warnings
- 🔴 Incorrect protocol compliance

### After Fix
- ✅ Only ONE `done: true` message sent
- ✅ Clean stream completion
- ✅ Correct protocol compliance
- ✅ No duplicate signals

---

## 🧪 Verification

### Build Status
```bash
npm run build
# ✅ Zero TypeScript errors
```

### Test Status
```bash
npm test
# ✅ 237/237 tests passing
```

### Expected Behavior

**When [DONE] arrives while buffering tool call**:
1. Handle tool call
2. Send done: true message (ONCE)
3. End stream
4. ✅ No duplicate done signals

**When [DONE] arrives with no tool call**:
1. Send done: true message (ONCE)
2. End stream
3. ✅ No duplicate done signals

---

## 📁 Files Modified

1. **`src/handlers/stream/formatConvertingStreamProcessor.ts`**
   - Fixed [DONE] handling to return early after handling buffered tool call
   - Prevents duplicate done: true messages
   - Added explanatory comments

2. **`DOUBLE_DONE_FIX.md`** (this file)
   - Complete documentation of the bug and fix

---

## 🎯 Related Fixes

This bug was discovered while reviewing the file after fixing the **stream completion bug** that caused infinite client loops. Both bugs were related to improper stream completion signal handling:

1. **Stream Completion Bug**: Premature completion signals preventing proper stream closure → **FIXED**
2. **Double Done Bug**: Duplicate completion signals after tool call handling → **FIXED**

Together, these fixes ensure clean, proper stream completion in all scenarios.

---

## 🔑 Key Lesson

**When a function handles completion internally, return immediately afterward.**

Don't fall through to additional completion logic that might send duplicate signals. Always trace through the complete execution path, especially when state is modified (like `resetToolCallState()` clearing flags).

---

**Status**: ✅ **COMPLETE AND VERIFIED**
**Build**: ✅ **PASSING**
**Tests**: ✅ **237/237 PASSING**
**Duplicate Signals**: ✅ **FIXED**
