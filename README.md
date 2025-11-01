# 🌉 ToolBridge

A versatile proxy server that enables tool/function calling capabilities across LLM providers and bridges the gap between different LLM API formats.

## 📑 Table of Contents

- [🚀 Introduction](#-introduction)
- [�️ Architecture Overview](#%EF%B8%8F-architecture-overview)
- [�🏁 Quick Start Guide](#-quick-start-guide)
- [💻 Usage Examples](#-usage-examples)
- [🆓 Free Models for Testing](#-free-models-for-testing)
- [⚙️ Configuration](#%EF%B8%8F-configuration)
- [🔧 Advanced Options](#-advanced-options)
- [🔌 Integration Examples](#-integration-examples)
- [🧩 Use Cases](#-use-cases)
- [📜 License](#-license)

## 🚀 Introduction

### ✨ Overview

ToolBridge acts as a bridge between different LLM APIs (primarily OpenAI and Ollama), enabling seamless communication regardless of the underlying formats. Its most powerful feature is enabling tool/function calling capabilities for models that don't natively support it, making advanced AI agent capabilities accessible with any LLM provider.

### 🔑 Key Features

- **🔄 Universal Tool/Function Calling**: Enable tool calling for any LLM, even those without native support
- **🔀 Bidirectional Format Translation**: Seamlessly convert between OpenAI and Ollama API formats
- **👥 Dual Client Support**: Use either OpenAI SDK or Ollama client - ToolBridge handles both!
- **🎯 Flexible Backend Selection**: Choose your target backend (OpenAI-compatible or Ollama)
- **🛠️ Robust XML Parsing**: Handles malformed XML, streaming fragments, and edge cases
- **📡 Streaming Support**: Works with both streaming and non-streaming responses
- **🔐 API Key Management**: Handle authentication for the configured backend
- **🔁 Tool Instruction Reinjection**: Automatically reinsert tool definitions for long conversations

## �️ Architecture Overview

ToolBridge is now organized as a modular service stack that keeps I/O concerns, translation logic, and provider-specific behaviour cleanly separated:

- **Service Layer (`src/services/`)** – `configService`, `formatDetectionService`, `translationService`, and `backendService` provide typed, reusable contracts for configuration, format routing, and backend access. HTTP handlers delegate to these services instead of manipulating low-level utilities directly.
- **Translation Engine (`src/translation/`)** – A universal router that converts any supported provider (OpenAI or Ollama) into a generic schema before re-emitting the requested target format. It also powers streaming conversions via provider-specific stream processors.
- **Format Detection & Capabilities (`src/translation/detection/`, `src/utils/formatDetectors/`)** – Robust detection maps request headers, bodies, and model hints to the proper provider, keeping “what format is this?” as a single source of truth.
- **Streaming Pipeline (`src/handlers/stream/`)** – Specialized processors (OpenAI SSE, Ollama line-delimited JSON, wrapper-aware converters) maintain tooling support even across chunked responses.
- **Logging & Diagnostics (`src/logging/`, `src/diagnostics/`)** – Structured logging plus targeted diagnostics scripts make it easy to inspect conversion pipelines and mock server traffic.

This separation means new providers or behaviours can be added by extending clear interfaces instead of editing ad-hoc utilities scattered throughout the codebase.

## �🏁 Quick Start Guide

### 📋 Prerequisites

- Node.js (v16+)
- npm or yarn
- An API key for your endpoint API(s) or access to OpenAI API compatible LLM APIs
- Optional: Ollama installation for local hosting

### 🔧 Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/oct4pie/toolbridge.git
   cd toolbridge
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy the configuration template (non-sensitive defaults live here):

  ```bash
  cp config.json.example config.json
  ```

  - Set `server.servingMode` to the client API your users expect (`openai` or `ollama`).
  - Set `backends.defaultMode` and related URLs to tell ToolBridge which provider it should target by default.
  - Optional: tune tool reinjection, streaming buffers, and test model defaults in the same file.

4. Copy the environment template (only secrets belong here):

  ```bash
  cp .env.example .env
  ```

5. Add your sensitive credentials to `.env`:

  ```properties
  # OpenAI or OpenRouter compatible keys
  BACKEND_LLM_API_KEY=sk-...

  # Optional: Ollama authentication
  OLLAMA_API_KEY=...
  ```

6. Start the proxy:
   ```bash
   npm start
   ```

## 💻 Usage Examples

### 👨‍💻 Demo: GitHub Copilot with Ollama

1. Configure GitHub Copilot to use Ollama as the endpoint
2. Then set up the proxy to communicate with your endpoint of choice
3. GitHub Copilot will now be able to use your model choice model with tools enabled



https://github.com/user-attachments/assets/1992fe23-4b41-472e-a443-836abc2f1cd9



### 🔄 Using OpenAI Client with Any Backend

```javascript
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "http://localhost:3000/v1", // Point to the proxy
});

const response = await openai.chat.completions.create({
  model: "llama3", // Works with any backend model
  messages: [{ role: "user", content: "Hello, world!" }],
  tools: [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get the current weather",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string" },
          },
          required: ["location"],
        },
      },
    },
  ],
});
```

### 🦙 Using Ollama Client with Any Backend

```javascript
import { OllamaClient } from "./test/utils/ollamaClient.js";

const ollama = new OllamaClient({
  baseURL: "http://localhost:3000", // Point to the proxy
  apiKey: "your-backend-api-key"    // For non-Ollama backends
});

const response = await ollama.chat({
  model: "gpt-4", // Works with any backend model
  messages: [
    { role: "user", content: "What's the weather like?" }
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather information",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string" }
          },
          required: ["location"]
        }
      }
    }
  ]
});
```

### 🔄 Format Conversion Utilities

ToolBridge includes utilities to convert between OpenAI and Ollama formats:

```javascript
import { 
  convertOpenAIToolsToOllama,
  convertOpenAIMessagesToOllama 
} from "./test/utils/ollamaClient.js";

// Convert OpenAI tools to Ollama format
const openaiTools = [/* your OpenAI tools */];
const ollamaTools = convertOpenAIToolsToOllama(openaiTools);

// Convert OpenAI messages to Ollama format  
const openaiMessages = [
  { role: "user", content: "Hello!" },
  { role: "assistant", content: "Hi there!" }
];
const ollamaMessages = convertOpenAIMessagesToOllama(openaiMessages);
```


## 🆓 Free Models for Testing

Several platforms provide free access to powerful open-source language models that work great with ToolBridge:

### 🌐 Available Platforms

- **[🚀 Chutes.ai](https://chutes.ai)**: Numerous deployed open-source AI models, many free for experimental usage
- **[🔄 OpenRouter](https://openrouter.ai)**: Access to many free-tier models with a unified API
- **[⚡ Targon.com](https://targon.com)**: High-performance inference for multiple models, with free models

#### 🤖 Notable Free Models

- **🧠 DeepSeek V3 & R1**: 685B-parameter MoE model and 671B-parameter flagship model
- **🔄 Qwen 2.5-3**: MoE model developed by Qwen, excellent reasoning
- **🦙 Llama-4-Maverick/Scout**: Meta's latest models, including the 400B MoE model with 17B active parameters
- **🔍 Google Gemini-2.5-Pro**: Advanced model with large context support
- **🌟 Mistral Small 3.1 (24B)**: Tuned for instruction-following tasks

These platforms make it easy to experiment with cutting-edge open-source models without investing in costly hardware or API credits.

## ⚙️ Configuration

ToolBridge now splits configuration responsibilities between **`config.json`** (non-sensitive defaults) and **`.env`** (secrets and provider credentials). `src/config.ts` loads both and exposes them via `configService`, so every consumer reads the exact same values.

### 🗂️ `config.json` – defaults & behaviour flags

Copy `config.json.example` and tweak:

| Section | Key Highlights |
| --- | --- |
| `server` | `servingMode` chooses the API shape clients see (`openai` or `ollama`), plus default host/port/debug flags. |
| `backends` | `defaultMode` selects the provider ToolBridge talks to, `defaultBaseUrls` holds per-provider endpoints, and provider-specific tuning (Ollama defaults) lives here. |
| `tools` | Toggle tool reinjection, maximum tool-call iterations, and whether tools are forwarded to the backend verbatim. |
| `performance` | Streaming and request timeout ceilings, buffer limits, and other throughput knobs. |
| `headers` | The default `HTTP_REFERER` and `X_TITLE` sent to OpenRouter-compatible services. |
| `testing` | Canonical model IDs used by the integration scripts and mock servers. |

### 🔐 `.env` – secrets & provider credentials

Only place API keys in this file. Supported keys include:

- `BACKEND_LLM_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` – used when `backends.defaultMode=openai` (only one needs to be set).
- `OLLAMA_API_KEY` when your Ollama deployment requires authentication.
- Optional overrides such as `DEBUG_MODE=true` for extra console logging.

At runtime the configuration service validates the combined view, logging a detailed summary and refusing to boot if required values are missing.

## 🔧 Advanced Options

### 🔀 Backend Selection Header

You can override the default backend _per request_ by sending the `x-backend-format` header:

- `x-backend-format: openai` - Force OpenAI format for backend communication
- `x-backend-format: ollama` - Force Ollama format for backend communication

### 🔁 Tool Instruction Reinjection

For long conversations, you can tune reinjection behaviour directly in `config.json`:

```json
{
  "tools": {
    "enableReinjection": true,
    "reinjectionTokenCount": 3000,
    "reinjectionMessageCount": 10,
    "reinjectionType": "system"
  }
}
```

Set `reinjectionType` to `user` if you prefer assistant-level context instead of system messages.

### ⚡ Performance Settings

Throughput knobs also live in `config.json`:

```json
{
  "performance": {
    "maxBufferSize": 1048576,
    "connectionTimeout": 120000,
    "maxStreamBufferSize": 1048576,
    "streamConnectionTimeout": 120000
  }
}
```

Values are expressed in bytes and milliseconds respectively.

## 🔌 Integration Examples

### 🌐 OpenWebUI + ToolBridge

[OpenWebUI](https://openwebui.com) is a web interface for LLM endpoints. By connecting it to ToolBridge:

1. Set ToolBridge as the API endpoint in OpenWebUI
2. Gain full tool/function calling support for any model
3. Benefit from bidirectional format translation

### 🔗 LiteLLM + ToolBridge

Create a powerful proxy chain with [LiteLLM](https://litellm.ai) and ToolBridge:

```
Client → LiteLLM Proxy → ToolBridge → Various LLM Providers
```

This setup enables provider routing, load balancing, and universal tool calling capabilities.

## 🛠 Developer Scripts

Several manual test harnesses now live under the `scripts/` directory. The most common ones are available via npm aliases:

- `npm run scripts:check-models` – call `/v1/models` on the running proxy and pretty-print the response.
- `npm run scripts:test-ollama-proxy` – send tool-enabled requests through ToolBridge when Ollama is configured as the backend, including a streaming scenario.
- `npm run scripts:test-all-features` – spin up all mock servers, the translation demo, and the proxy itself before executing a comprehensive integration sweep.

See [`docs/SCRIPTS_AND_SERVERS.md`](./docs/SCRIPTS_AND_SERVERS.md) for the full catalog and additional guidance.

## 🧩 Use Cases

### 1️⃣ Enable Agent Mode with Custom Models

- Connect to Ollama/OpenAI Compatible API or any other provider (liteLLM/openrouter)
- Enable agent functionality with any model
- Use your preferred local or cloud-hosted models with full tool capabilities

### 2️⃣ Add Function Calling to Open Source Models

- Transform XML outputs from open source models into structured function calls
- Make models like Llama, Mistral, or Gemma compatible with tools-based applications
- Eliminate the need to fine-tune models specifically for function calling

### 3️⃣ LangChain/LlamaIndex Agent Development

- Use the same code to test agents across different model providers
- Develop with cheaper/faster models locally, then deploy with high-performance models

### 4️⃣ API Gateway

- Centralize authentication and API key management
- Implement consistent logging and monitoring
- Standardize the format of interactions with various LLM services

### 🛠️ Featured Tools & Frameworks

- **🧰 Development Tools**: GitHub Copilot, VS Code AI Extensions, JetBrains AI Assistant
- **🤖 AI Frameworks**: LangChain, LlamaIndex, CrewAI, Auto-GPT
- **🖥️ Web Interfaces**: OpenWebUI, LiteLLM, etc.


## 📜 License

ToolBridge is released under the MIT [License](./LICENSE). See the LICENSE file for more details.
