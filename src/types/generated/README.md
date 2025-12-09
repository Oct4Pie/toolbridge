# Generated API Types - SSOT

**Single Source of Truth (SSOT) for OpenAI and Ollama API types**

This directory contains TypeScript types auto-generated from **live API endpoints** using `quicktype`. These types are guaranteed to match the actual API responses, providing 100% compatibility.

## 🔄 Regenerating Types

To regenerate types from live endpoints:

```bash
npm run generate:types
```

**When to regenerate:**
- After API updates
- When adding new endpoint coverage
- To capture latest schema changes

## 📁 Directory Structure

```
src/types/generated/
├── README.md                      # This file
├── index.ts                       # Main exports (use namespaces)
├── openai/
│   ├── index.ts                   # OpenAI type exports
│   ├── models-list.ts             # GET /v1/models
│   ├── chat-completion.ts         # POST /v1/chat/completions
│   └── chat-completion-tools.ts   # POST /v1/chat/completions (with tools)
└── ollama/
    ├── index.ts                   # Ollama type exports
    ├── tags.ts                    # GET /api/tags
    ├── show.ts                    # POST /api/show
    ├── chat.ts                    # POST /api/chat (non-streaming)
    ├── generate.ts                # POST /api/generate (non-streaming)
    └── chat-stream-chunk.ts       # POST /api/chat (streaming chunk)
```

## 📖 Usage

### Option 1: Namespace Imports (Recommended)

```typescript
import { OpenAI, Ollama } from './types/generated/index.js';

// Use OpenAI types
const models: OpenAI.ModelsListResponse = await fetch('/v1/models');
const chat: OpenAI.ChatCompletionResponse = await fetch('/v1/chat/completions');

// Use Ollama types
const tags: Ollama.TagsResponse = await fetch('/api/tags');
const show: Ollama.ShowResponse = await fetch('/api/show');
```

### Option 2: Direct Imports

```typescript
import { ModelsListResponse } from './types/generated/openai/models-list.js';
import { ChatCompletionResponse } from './types/generated/openai/chat-completion.js';
import { TagsResponse } from './types/generated/ollama/tags.js';

const models: ModelsListResponse = await fetch('/v1/models');
const chat: ChatCompletionResponse = await fetch('/v1/chat/completions');
const tags: TagsResponse = await fetch('/api/tags');
```

## 🎯 SSOT Principles

### Why This is SSOT

1. **Single Source:** Types generated from actual API responses (not manually written)
2. **Auto-Generated:** Eliminates human error in type definitions
3. **Reproducible:** `npm run generate:types` regenerates from live APIs
4. **Validated:** Types match reality, not documentation

### How to Maintain SSOT

**✅ DO:**
- Import types from `src/types/generated/`
- Regenerate when APIs change
- Use these types in translation layer
- Reference this as the authoritative schema

**❌ DON'T:**
- Manually edit generated files (they'll be overwritten)
- Duplicate type definitions elsewhere
- Create similar types outside this directory
- Modify the generation script without testing

## 🔧 Generation Process

The generation script (`scripts/generate-api-types.sh`) does:

1. **Fetch responses** from live endpoints:
   - OpenAI: Uses OpenRouter (OpenAI-compatible)
   - Ollama: Uses local Ollama server (`http://localhost:11434`)

2. **Generate TypeScript types** using `quicktype`:
   ```bash
   curl -s API_URL > response.json
   quicktype -l ts -s json -t TypeName --just-types -o output.ts response.json
   ```

3. **Create index files** for organized imports

## 📊 Covered Endpoints

### OpenAI API (via OpenRouter)

| Endpoint | Type | File |
|----------|------|------|
| `GET /v1/models` | `ModelsListResponse` | `openai/models-list.ts` |
| `POST /v1/chat/completions` | `ChatCompletionResponse` | `openai/chat-completion.ts` |
| `POST /v1/chat/completions` (with tools) | `ChatCompletionWithToolsResponse` | `openai/chat-completion-tools.ts` |

### Ollama API

| Endpoint | Type | File |
|----------|------|------|
| `GET /api/tags` | `TagsResponse` | `ollama/tags.ts` |
| `POST /api/show` | `ShowResponse` | `ollama/show.ts` |
| `POST /api/chat` (non-streaming) | `ChatResponse` | `ollama/chat.ts` |
| `POST /api/generate` (non-streaming) | `GenerateResponse` | `ollama/generate.ts` |
| `POST /api/chat` (streaming chunk) | `ChatStreamChunk` | `ollama/chat-stream-chunk.ts` |

## 🧪 Testing

Verify types compile:

```bash
npx tsc --noEmit src/types/generated/**/*.ts
```

## 🚨 Important Notes

- **DO NOT EDIT** generated files - they are overwritten on regeneration
- **Ollama types** require local Ollama server running at `http://localhost:11434`
- **Model names** in generation script may need updating (e.g., `gemma3:1b`)
- **API keys** required in `.env` as `BACKEND_LLM_API_KEY` for OpenRouter

## 📝 Adding New Endpoints

To add coverage for a new endpoint:

1. Edit `scripts/generate-api-types.sh`
2. Add fetch + quicktype commands for the new endpoint
3. Add export to appropriate index file
4. Run `npm run generate:types`
5. Verify compilation with `npx tsc --noEmit`

## 🔗 Related

- `src/translation/` - Uses these types for format conversion
- `src/handlers/` - Consumes these types for request/response handling
- `scripts/generate-api-types.sh` - Generation script
- `package.json` - `npm run generate:types` command

---

**Last Generated:** Run `npm run generate:types` to update
**Maintained By:** Auto-generation script (SSOT principle)
