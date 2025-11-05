#!/bin/bash

echo "Testing ToolBridge Ollama Endpoints"
echo "===================================="
echo ""

# Start ToolBridge in background
echo "Starting ToolBridge..."
npm run dev > /dev/null 2>&1 &
TOOLBRIDGE_PID=$!

# Wait for it to start
sleep 3

echo ""
echo "1. Testing /api/tags (should be SIMPLE, no capabilities)"
echo "-----------------------------------------------------------"
curl -s http://127.0.0.1:3100/api/tags | jq '.models[] | {name, size, details}' | head -20
echo ""
echo ""

echo "2. Testing /api/show (should have DETAILED info WITH capabilities)"
echo "-------------------------------------------------------------------"
curl -s http://127.0.0.1:3100/api/show -d '{"model":"qwen3"}' | jq '{details, capabilities, has_license: (.license != null), has_modelfile: (.modelfile != null)}'
echo ""
echo ""

echo "3. Checking /api/tags does NOT have capabilities field"
echo "-------------------------------------------------------"
if curl -s http://127.0.0.1:3100/api/tags | jq '.models[0] | has("capabilities")' | grep -q "false"; then
    echo "✅ PASS: /api/tags does not include capabilities"
else
    echo "❌ FAIL: /api/tags incorrectly includes capabilities"
fi
echo ""

echo "4. Checking /api/show DOES have capabilities field"
echo "---------------------------------------------------"
if curl -s http://127.0.0.1:3100/api/show -d '{"model":"qwen3"}' | jq 'has("capabilities")' | grep -q "true"; then
    echo "✅ PASS: /api/show includes capabilities"
else
    echo "❌ FAIL: /api/show missing capabilities"
fi
echo ""

echo "5. Checking /api/show capabilities includes 'tools'"
echo "----------------------------------------------------"
if curl -s http://127.0.0.1:3100/api/show -d '{"model":"qwen3"}' | jq '.capabilities | contains(["tools"])' | grep -q "true"; then
    echo "✅ PASS: capabilities includes 'tools'"
else
    echo "❌ FAIL: capabilities missing 'tools'"
fi
echo ""

# Cleanup
kill $TOOLBRIDGE_PID 2>/dev/null
echo "Cleanup complete"
