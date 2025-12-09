#!/bin/bash
set -e

# Script to generate TypeScript types from live API endpoints using quicktype
# This ensures 100% compatibility with actual API responses

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

echo "🚀 Generating API types from live endpoints..."
echo ""

# Configuration
OPENAI_API_KEY="${BACKEND_LLM_API_KEY}"
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
OPENROUTER_BASE="https://openrouter.ai/api/v1"
OUTPUT_DIR="src/types/generated"
# Use non-free tier to avoid rate limits
MODEL="openai/gpt-oss-20b"

# Verify API key is set
if [ -z "$OPENAI_API_KEY" ]; then
  echo "❌ Error: BACKEND_LLM_API_KEY not set in .env"
  exit 1
fi

# Create output directories
mkdir -p "${OUTPUT_DIR}/openai"
mkdir -p "${OUTPUT_DIR}/ollama"
mkdir -p "${OUTPUT_DIR}/temp"

# ============================================================
# OpenAI API Types (using OpenRouter as OpenAI-compatible)
# ============================================================

echo "📡 Generating OpenAI API types..."

# 1. GET /v1/models - List models
echo "  → /v1/models (list models)"
curl -s "${OPENROUTER_BASE}/models" > "${OUTPUT_DIR}/temp/openai-models.json"

npx --yes quicktype@latest \
  -l ts \
  -s json \
  -t ModelsListResponse \
  --just-types --no-date-times \
  -o "${OUTPUT_DIR}/openai/models-list.ts" \
  "${OUTPUT_DIR}/temp/openai-models.json"

# 2. POST /v1/chat/completions (multiple variations to capture optional fields)
echo "  → /v1/chat/completions (multiple variations)"

# Variation 1: Simple chat completion
CHAT_SIMPLE=$(curl -s "${OPENROUTER_BASE}/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -d "{
    \"model\": \"${MODEL}\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Say hello\"}],
    \"max_tokens\": 10,
    \"stream\": false
  }")
echo "${CHAT_SIMPLE}" > "${OUTPUT_DIR}/temp/openai-chat-1.json"

# Variation 2: With tool call (weather function)
CHAT_TOOLS_1=$(curl -s "${OPENROUTER_BASE}/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -d "{
    \"model\": \"${MODEL}\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Get weather for San Francisco\"}],
    \"tools\": [{
      \"type\": \"function\",
      \"function\": {
        \"name\": \"get_weather\",
        \"description\": \"Get current weather\",
        \"parameters\": {
          \"type\": \"object\",
          \"properties\": {
            \"location\": {\"type\": \"string\"},
            \"unit\": {\"type\": \"string\", \"enum\": [\"celsius\", \"fahrenheit\"]}
          },
          \"required\": [\"location\"]
        }
      }
    }],
    \"tool_choice\": \"required\",
    \"max_tokens\": 100,
    \"stream\": false
  }")
echo "${CHAT_TOOLS_1}" > "${OUTPUT_DIR}/temp/openai-chat-2.json"

# Variation 3: Different tool with different parameters
CHAT_TOOLS_2=$(curl -s "${OPENROUTER_BASE}/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -d "{
    \"model\": \"${MODEL}\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Calculate 5 + 3\"}],
    \"tools\": [{
      \"type\": \"function\",
      \"function\": {
        \"name\": \"calculate\",
        \"description\": \"Perform calculation\",
        \"parameters\": {
          \"type\": \"object\",
          \"properties\": {
            \"operation\": {\"type\": \"string\"},
            \"a\": {\"type\": \"number\"},
            \"b\": {\"type\": \"number\"}
          },
          \"required\": [\"operation\", \"a\", \"b\"]
        }
      }
    }],
    \"tool_choice\": \"required\",
    \"max_tokens\": 100,
    \"stream\": false
  }")
echo "${CHAT_TOOLS_2}" > "${OUTPUT_DIR}/temp/openai-chat-3.json"

# Generate unified type from all variations
npx --yes quicktype@latest \
  -l ts \
  -s json \
  -t ChatCompletionResponse \
  --just-types --no-date-times \
  -o "${OUTPUT_DIR}/openai/chat-completion.ts" \
  "${OUTPUT_DIR}/temp/openai-chat-1.json" \
  "${OUTPUT_DIR}/temp/openai-chat-2.json" \
  "${OUTPUT_DIR}/temp/openai-chat-3.json"

# 3. POST /v1/chat/completions (streaming - multiple chunk variations)
echo "  → /v1/chat/completions (streaming variations)"

# Get multiple chunks from stream to capture all variations (first, middle, last)
# Use stream_options to include usage in final chunk
curl -s -N "${OPENROUTER_BASE}/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -d "{
    \"model\": \"${MODEL}\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Count to 10\"}],
    \"max_tokens\": 50,
    \"stream\": true,
    \"stream_options\": {\"include_usage\": true}
  }" | grep "^data: " | sed 's/^data: //' | grep -v '^\[DONE\]' > "${OUTPUT_DIR}/temp/openai-stream-chunks-all.txt"

# Extract specific chunks: first (role), middle (content), and last (usage)
awk 'NR==1' "${OUTPUT_DIR}/temp/openai-stream-chunks-all.txt" > "${OUTPUT_DIR}/temp/openai-stream-1.json"  # First: role
awk 'NR==3' "${OUTPUT_DIR}/temp/openai-stream-chunks-all.txt" > "${OUTPUT_DIR}/temp/openai-stream-2.json"  # Middle: content
tail -n 1 "${OUTPUT_DIR}/temp/openai-stream-chunks-all.txt" > "${OUTPUT_DIR}/temp/openai-stream-3.json"    # Last: usage

# Generate unified streaming type from multiple chunks
npx --yes quicktype@latest \
  -l ts \
  -s json \
  -t ChatCompletionStreamChunk \
  --just-types --no-date-times \
  -o "${OUTPUT_DIR}/openai/chat-completion-stream-chunk.ts" \
  "${OUTPUT_DIR}/temp/openai-stream-1.json" \
  "${OUTPUT_DIR}/temp/openai-stream-2.json" \
  "${OUTPUT_DIR}/temp/openai-stream-3.json"

# ============================================================
# Ollama API Types (from local Ollama server)
# ============================================================

echo ""
echo "📡 Generating Ollama API types..."

# Check if Ollama is reachable
if ! curl -sf "${OLLAMA_HOST}/api/tags" > /dev/null; then
  echo "⚠️  Ollama server not reachable at ${OLLAMA_HOST}"
  echo "   Skipping Ollama type generation"
  echo "   To generate Ollama types, start Ollama and re-run this script"
else
  # 1. GET /api/tags - List models
  echo "  → /api/tags (list models)"
  curl -s "${OLLAMA_HOST}/api/tags" > "${OUTPUT_DIR}/temp/ollama-tags.json"

  npx --yes quicktype@latest \
    -l ts \
    -s json \
    -t TagsResponse \
    --just-types --no-date-times \
    -o "${OUTPUT_DIR}/ollama/tags.ts" \
    "${OUTPUT_DIR}/temp/ollama-tags.json"

  # 2. POST /api/show - Get model info
  echo "  → /api/show (model info)"
  SHOW_RESPONSE=$(curl -s "${OLLAMA_HOST}/api/show" \
    -H "Content-Type: application/json" \
    -d '{"name": "qwen3:latest"}')

  echo "${SHOW_RESPONSE}" > "${OUTPUT_DIR}/temp/ollama-show-response.json"

  npx --yes quicktype@latest \
    -l ts \
    -s json \
    -t ShowResponse \
    --just-types --no-date-times \
    -o "${OUTPUT_DIR}/ollama/show.ts" \
    "${OUTPUT_DIR}/temp/ollama-show-response.json"

  # 3. POST /api/chat (multiple variations)
  echo "  → /api/chat (multiple variations)"

  # Variation 1: Simple chat
  CHAT_SIMPLE=$(curl -s "${OLLAMA_HOST}/api/chat" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "qwen3:latest",
      "messages": [{"role": "user", "content": "Say hello"}],
      "stream": false
    }')
  echo "${CHAT_SIMPLE}" > "${OUTPUT_DIR}/temp/ollama-chat-1.json"

  # Variation 2: With weather tool
  CHAT_TOOLS_1=$(curl -s "${OLLAMA_HOST}/api/chat" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "qwen3:latest",
      "messages": [{"role": "user", "content": "Get weather for Paris"}],
      "tools": [{
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get current weather",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {"type": "string"},
              "unit": {"type": "string"}
            },
            "required": ["location"]
          }
        }
      }],
      "stream": false
    }')
  echo "${CHAT_TOOLS_1}" > "${OUTPUT_DIR}/temp/ollama-chat-2.json"

  # Variation 3: Different tool with different parameters
  CHAT_TOOLS_2=$(curl -s "${OLLAMA_HOST}/api/chat" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "qwen3:latest",
      "messages": [{"role": "user", "content": "Calculate 10 + 5"}],
      "tools": [{
        "type": "function",
        "function": {
          "name": "calculate",
          "description": "Perform calculation",
          "parameters": {
            "type": "object",
            "properties": {
              "operation": {"type": "string"},
              "x": {"type": "number"},
              "y": {"type": "number"}
            },
            "required": ["operation", "x", "y"]
          }
        }
      }],
      "stream": false
    }')
  echo "${CHAT_TOOLS_2}" > "${OUTPUT_DIR}/temp/ollama-chat-3.json"

  # Generate unified type from all variations
  npx --yes quicktype@latest \
    -l ts \
    -s json \
    -t ChatResponse \
    --just-types --no-date-times \
    -o "${OUTPUT_DIR}/ollama/chat.ts" \
    "${OUTPUT_DIR}/temp/ollama-chat-1.json" \
    "${OUTPUT_DIR}/temp/ollama-chat-2.json" \
    "${OUTPUT_DIR}/temp/ollama-chat-3.json"

  # Post-process: Replace specific Arguments interface with generic Record<string, unknown>
  # This is necessary because tool call arguments vary by function
  sed -i.bak '/^export interface Arguments {/,/^}/c\
export type Arguments = Record<string, unknown>;
' "${OUTPUT_DIR}/ollama/chat.ts"

  # Also update the Function interface to use the type alias
  sed -i.bak 's/arguments: Arguments;/arguments: Record<string, unknown>;/' "${OUTPUT_DIR}/ollama/chat.ts"

  rm "${OUTPUT_DIR}/ollama/chat.ts.bak"

  # 4. POST /api/generate (non-streaming)
  echo "  → /api/generate (generation response)"
  GENERATE_RESPONSE=$(curl -s "${OLLAMA_HOST}/api/generate" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "qwen3:latest",
      "prompt": "Hello",
      "stream": false
    }')

  echo "${GENERATE_RESPONSE}" > "${OUTPUT_DIR}/temp/ollama-generate-response.json"

  npx --yes quicktype@latest \
    -l ts \
    -s json \
    -t GenerateResponse \
    --just-types --no-date-times \
    -o "${OUTPUT_DIR}/ollama/generate.ts" \
    "${OUTPUT_DIR}/temp/ollama-generate-response.json"

  # 5. POST /api/chat (streaming - multiple chunk variations)
  echo "  → /api/chat (streaming variations)"

  # Get all chunks from stream to capture variations (first, middle, and final done=true chunk)
  curl -s -N "${OLLAMA_HOST}/api/chat" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "qwen3:latest",
      "messages": [{"role": "user", "content": "Count to 10"}],
      "stream": true
    }' > "${OUTPUT_DIR}/temp/ollama-stream-chunks-all.txt"

  # Extract specific chunks: first, middle, and final (done=true with all metrics)
  awk 'NR==1' "${OUTPUT_DIR}/temp/ollama-stream-chunks-all.txt" > "${OUTPUT_DIR}/temp/ollama-stream-1.json"  # First
  awk 'NR==3' "${OUTPUT_DIR}/temp/ollama-stream-chunks-all.txt" > "${OUTPUT_DIR}/temp/ollama-stream-2.json"  # Middle
  tail -n 1 "${OUTPUT_DIR}/temp/ollama-stream-chunks-all.txt" > "${OUTPUT_DIR}/temp/ollama-stream-3.json"    # Final: done=true

  # Generate unified type from multiple chunks
  npx --yes quicktype@latest \
    -l ts \
    -s json \
    -t ChatStreamChunk \
    --just-types --no-date-times \
    -o "${OUTPUT_DIR}/ollama/chat-stream-chunk.ts" \
    "${OUTPUT_DIR}/temp/ollama-stream-1.json" \
    "${OUTPUT_DIR}/temp/ollama-stream-2.json" \
    "${OUTPUT_DIR}/temp/ollama-stream-3.json"

  # 6. GET /api/version - Version info
  echo "  → /api/version (version info)"
  VERSION_RESPONSE=$(curl -s "${OLLAMA_HOST}/api/version")

  echo "${VERSION_RESPONSE}" > "${OUTPUT_DIR}/temp/ollama-version.json"

  npx --yes quicktype@latest \
    -l ts \
    -s json \
    -t VersionResponse \
    --just-types --no-date-times \
    -o "${OUTPUT_DIR}/ollama/version.ts" \
    "${OUTPUT_DIR}/temp/ollama-version.json"
fi

# ============================================================
# Create index files for easy imports
# ============================================================

echo ""
echo "📝 Creating index files..."

cat > "${OUTPUT_DIR}/openai/index.ts" << 'EOF'
// Auto-generated OpenAI API types from live endpoints
// DO NOT EDIT - regenerate with: npm run generate:types
//
// Types generated from multiple API response variations to ensure optional fields are correctly inferred

export type { ModelsListResponse, Datum as Model } from './models-list.js';
export type {
  ChatCompletionResponse,
  Choice,
  Message,
  ToolCall,
  Function as ToolFunction,
  ReasoningDetail,
  Usage,
  CompletionTokensDetails
} from './chat-completion.js';
export type {
  ChatCompletionStreamChunk,
  Choice as StreamChoice,
  Delta,
  Usage as StreamUsage
} from './chat-completion-stream-chunk.js';
EOF

cat > "${OUTPUT_DIR}/ollama/index.ts" << 'EOF'
// Auto-generated Ollama API types from live endpoints
// DO NOT EDIT - regenerate with: npm run generate:types
//
// Types generated from multiple API response variations to ensure optional fields are correctly inferred

export type { TagsResponse, Model } from './tags.js';
export type { ShowResponse } from './show.js';
export type {
  ChatResponse,
  Message,
  ToolCall,
  Function
} from './chat.js';
export type { GenerateResponse } from './generate.js';
export type { ChatStreamChunk } from './chat-stream-chunk.js';
export type { VersionResponse } from './version.js';
EOF

cat > "${OUTPUT_DIR}/index.ts" << 'EOF'
// Auto-generated API types from live endpoints
// SSOT for OpenAI and Ollama API types
// DO NOT EDIT - regenerate with: npm run generate:types

export * as OpenAI from './openai/index.js';
export * as Ollama from './ollama/index.js';
EOF

# ============================================================
# Cleanup
# ============================================================

echo ""
echo "🧹 Cleaning up temporary files..."
rm -rf "${OUTPUT_DIR}/temp"

echo ""
echo "✅ Type generation complete!"
echo ""
echo "Generated types:"
echo "  → OpenAI: ${OUTPUT_DIR}/openai/"
echo "  → Ollama: ${OUTPUT_DIR}/ollama/"
echo ""
echo "Import with: import { OpenAI, Ollama } from './types/generated/index.js'"
