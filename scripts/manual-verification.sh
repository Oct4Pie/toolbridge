#!/bin/bash
# Manual Verification Test Suite for ToolBridge
# Phase 2: Live Server Testing

BASE_URL="http://localhost:3100"
PASS=0
FAIL=0

echo "==========================================="
echo "ToolBridge Manual Verification Test Suite"
echo "Server: $BASE_URL"
echo "==========================================="
echo ""

# Test 1: Health/Version Check
echo "Test 1: API Version Check"
RESULT=$(curl -s "$BASE_URL/api/version")
if echo "$RESULT" | grep -q "version"; then
    echo "  ✅ PASS: Server responding with version"
    ((PASS++))
else
    echo "  ❌ FAIL: No version response"
    ((FAIL++))
fi
echo "  Response: $RESULT"
echo ""

# Test 2: Model Listing (OpenAI format)
echo "Test 2: OpenAI Models Endpoint"
RESULT=$(curl -s "$BASE_URL/v1/models" | head -c 500)
if echo "$RESULT" | grep -q "data"; then
    echo "  ✅ PASS: Models endpoint returns data array"
    ((PASS++))
else
    echo "  ❌ FAIL: Invalid models response"
    ((FAIL++))
fi
echo "  Response (first 200 chars): $(echo "$RESULT" | head -c 200)"
echo ""

# Test 3: Ollama Tags Endpoint (translation)
echo "Test 3: Ollama Tags Endpoint (translated from OpenAI)"
RESULT=$(curl -s "$BASE_URL/api/tags")
if echo "$RESULT" | grep -q "models"; then
    echo "  ✅ PASS: Tags endpoint returns Ollama format"
    ((PASS++))
else
    echo "  ❌ FAIL: Invalid tags response"
    ((FAIL++))
fi
echo "  Response (first 200 chars): $(echo "$RESULT" | head -c 200)"
echo ""

# Test 4: Non-Streaming Chat (Ollama format with tools)
echo "Test 4: Non-Streaming Ollama Chat with Tool"
RESULT=$(curl -s -X POST "$BASE_URL/api/chat" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "openai/gpt-4o-mini",
        "messages": [
            {"role": "user", "content": "What is 2+2? Use the calculator tool to compute it."}
        ],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "calculator",
                    "description": "Perform basic arithmetic",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "expression": {"type": "string", "description": "Math expression"}
                        },
                        "required": ["expression"]
                    }
                }
            }
        ],
        "stream": false
    }' 2>&1)

if echo "$RESULT" | grep -q "message"; then
    echo "  ✅ PASS: Non-streaming chat returns message"
    ((PASS++))
    
    # Check for tool calls
    if echo "$RESULT" | grep -q "tool_calls"; then
        echo "  ✅ BONUS: Tool call detected in response!"
    fi
else
    echo "  ❌ FAIL: Invalid chat response"
    echo "  Response: $RESULT"
    ((FAIL++))
fi
echo ""

# Test 5: Streaming Chat (Ollama format)
echo "Test 5: Streaming Ollama Chat"
STREAM_OUTPUT=$(curl -s -X POST "$BASE_URL/api/chat" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "openai/gpt-4o-mini",
        "messages": [
            {"role": "user", "content": "Say hello in exactly 3 words."}
        ],
        "stream": true
    }' 2>&1 | head -c 2000)

if echo "$STREAM_OUTPUT" | grep -q "response"; then
    echo "  ✅ PASS: Streaming returns NDJSON chunks"
    ((PASS++))
else
    echo "  ❌ FAIL: Invalid streaming response"
    ((FAIL++))
fi
echo "  First chunks: $(echo "$STREAM_OUTPUT" | head -c 300)"
echo ""

# Test 6: OpenAI Format Non-Streaming
echo "Test 6: OpenAI Format Chat Completion"
RESULT=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "openai/gpt-4o-mini",
        "messages": [
            {"role": "user", "content": "Reply with just the word OK"}
        ],
        "stream": false
    }' 2>&1)

if echo "$RESULT" | grep -q "choices"; then
    echo "  ✅ PASS: OpenAI chat completion returns choices"
    ((PASS++))
else
    echo "  ❌ FAIL: Invalid OpenAI response"
    ((FAIL++))
fi
echo "  Response (first 300 chars): $(echo "$RESULT" | head -c 300)"
echo ""

# Test 7: OpenAI Streaming
echo "Test 7: OpenAI Streaming Chat"
STREAM_OUTPUT=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "openai/gpt-4o-mini",
        "messages": [
            {"role": "user", "content": "Say hi"}
        ],
        "stream": true
    }' 2>&1 | head -c 2000)

if echo "$STREAM_OUTPUT" | grep -q "data:"; then
    echo "  ✅ PASS: OpenAI streaming returns SSE format"
    ((PASS++))
else
    echo "  ❌ FAIL: Invalid SSE response"
    ((FAIL++))
fi
echo "  First chunks: $(echo "$STREAM_OUTPUT" | head -c 400)"
echo ""

# Summary
echo "==========================================="
echo "           VERIFICATION SUMMARY           "
echo "==========================================="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "  Total:  $((PASS + FAIL))"
echo ""

if [ $FAIL -eq 0 ]; then
    echo "🎉 ALL TESTS PASSED!"
    exit 0
else
    echo "⚠️  Some tests failed. Check output above."
    exit 1
fi
