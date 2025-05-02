# 🌉 ToolBridge

A versatile proxy server that enables tool/function calling capabilities across LLM providers and bridges the gap between different LLM API formats.

## 📑 Table of Contents

- [🚀 Introduction](#-introduction)
- [🏁 Quick Start Guide](#-quick-start-guide)
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
- **🎯 Flexible Backend Selection**: Choose your target backend (OpenAI-compatible or Ollama)
- **🛠️ Robust XML Parsing**: Handles malformed XML, streaming fragments, and edge cases
- **📡 Streaming Support**: Works with both streaming and non-streaming responses
- **🔐 API Key Management**: Handle authentication for the configured backend
- **🔁 Tool Instruction Reinjection**: Automatically reinsert tool definitions for long conversations

## 🏁 Quick Start Guide

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

3. Configure environment:

   ```bash
   cp .env.example .env
   ```

4. Edit basic configuration in `.env`:

   ```properties
   # === Backend Mode Configuration ===
   BACKEND_MODE=openai  # Choose "openai" or "ollama"

   # === OpenAI Backend Configuration ===
   # Only needed if BACKEND_MODE=openai
   BACKEND_LLM_BASE_URL=https://api.openai.com
   BACKEND_LLM_API_KEY=your_openai_api_key

   # === Ollama Backend Configuration ===
   # Only needed if BACKEND_MODE=ollama
   OLLAMA_BASE_URL=http://localhost:11434

   # === Proxy Server Configuration ===
   PROXY_PORT=3000
   PROXY_HOST=0.0.0.0
   ```

5. Start the proxy:
   ```bash
   npm start
   ```

## 💻 Usage Examples

### 👨‍💻 Demo: GitHub Copilot with Ollama

1. Configure GitHub Copilot to use Ollama as the endpoint
2. Then set up the proxy to communicate with your endpoint of choice
3. GitHub Copilot will now be able to use your model choice model with tools enabled



https://github.com/user-attachments/assets/1992fe23-4b41-472e-a443-836abc2f1cd9



### 🔄 Using OpenAI Client with Ollama Backend

```javascript
const openai = new OpenAI({
  baseURL: "http://localhost:3000/v1", // Point to the proxy
});

const response = await openai.chat.completions.create({
  model: "llama3", // Ollama model name
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

### 🔄 Using Ollama Client with OpenAI Backend

```javascript
const response = await fetch("http://localhost:3000/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "gpt-4",
    prompt: "What's the weather like?",
    stream: false,
  }),
});
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

The primary configuration is done via the `.env` file. Here are the key settings based on the project's config.js:

**🔍 General Settings:**

- `DEBUG_MODE`: Set to `true` for verbose debugging logs (default: `false`)

**🔀 Backend Selection:**

- `BACKEND_MODE`: Set to `openai` (default) or `ollama` to determine which backend endpoint the proxy connects to

**☁️ OpenAI Backend Configuration:**

- `BACKEND_LLM_BASE_URL`: The base URL of your OpenAI-compatible backend
- `BACKEND_LLM_CHAT_PATH`: (Optional) Custom path for chat completions endpoint if different from `/v1/chat/completions`
- `BACKEND_LLM_API_KEY`: Your OpenAI API key (optional if clients provide their own)

**🦙 Ollama Backend Configuration:**

- `OLLAMA_BASE_URL`: The base URL of your Ollama instance (e.g., `http://localhost:11434`)
- `OLLAMA_API_KEY`: (Optional) API key for Ollama if your instance requires authentication
- `OLLAMA_DEFAULT_CONTEXT_LENGTH`: (Optional) Context length for synthetic responses (default: 32768)

**🖥️ Server Settings:**

- `PROXY_PORT`: The port the proxy server will listen on (default: `3000`) - use `11434` to match Ollama's port
- `PROXY_HOST`: The host address to bind to (default: `0.0.0.0`)

**🔄 Tool Reinjection Settings:**

- `ENABLE_TOOL_REINJECTION`: Set to `true` to enable automatic tool instruction reinjection (default: `false`)
- `TOOL_REINJECTION_TOKEN_COUNT`: Number of tokens before reinjection (default: 3000)
- `TOOL_REINJECTION_MESSAGE_COUNT`: Number of messages before reinjection (default: 10)
- `TOOL_REINJECTION_TYPE`: Type of reinjection: "full" or "reminder" (default: "full")

**⚡ Performance Settings:**

- `MAX_BUFFER_SIZE`: Maximum buffer size for stream processing in bytes (default: 1MB)
- `CONNECTION_TIMEOUT`: Timeout for requests to the backend LLM in milliseconds (default: 120000)

**🔗 OpenRouter Integration:**

- `HTTP_REFERER`: Optional referrer URL for OpenRouter tracking
- `X_TITLE`: Optional application name for OpenRouter tracking

## 🔧 Advanced Options

### 🔀 Backend Selection Header

You can override the default backend _per request_ by sending the `x-backend-format` header:

- `x-backend-format: openai` - Force OpenAI format for backend communication
- `x-backend-format: ollama` - Force Ollama format for backend communication

### 🔁 Tool Instruction Reinjection

For long conversations, you can enable automatic reinjection of tool definitions:

```properties
# In .env file
ENABLE_TOOL_REINJECTION=true
TOOL_REINJECTION_TOKEN_COUNT=3000
TOOL_REINJECTION_MESSAGE_COUNT=10
TOOL_REINJECTION_TYPE=full
```

### ⚡ Performance Settings

```properties
# In .env file
MAX_BUFFER_SIZE=1048576  # 1MB buffer size for streams
CONNECTION_TIMEOUT=120000 # 2 minutes timeout
```

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
