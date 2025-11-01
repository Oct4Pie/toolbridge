#!/usr/bin/env node
/* eslint-disable no-console */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configPath = join(__dirname, "..", "..", "config.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const TEST_MODEL =
  process.env.TEST_MODEL_OLLAMA || config.testing.models.ollama || "qwen3:latest";

console.log("\n🧪 Testing Ollama → OpenAI Proxy with Tool Calling\n");
console.log(`📝 Test Model: ${TEST_MODEL}`);
console.log("🔧 Proxy: http://localhost:3000/v1/chat/completions");
console.log("🎯 Backend: Ollama at http://localhost:11434\n");

const tools = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather in a given location",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "The city and state, e.g. San Francisco, CA",
          },
          unit: {
            type: "string",
            enum: ["celsius", "fahrenheit"],
            description: "The temperature unit",
          },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description: "Perform a mathematical calculation",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "The mathematical expression to evaluate, e.g. \"2 + 2\"",
          },
        },
        required: ["expression"],
      },
    },
  },
];

const proxyUrl = "http://localhost:3000/v1/chat/completions";

async function runJsonRequest(title, body) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📋 ${title}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("📤 Request:", JSON.stringify(body, null, 2));

  try {
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    console.log("\n📥 Response Status:", response.status);
    console.log("📥 Response Body:", JSON.stringify(data, null, 2));

    if (data.choices && data.choices[0]) {
      const message = data.choices[0].message;
      console.log("\n✅ Response Message:");
      console.log("   Role:", message.role);
      console.log("   Content:", message.content || "(empty)");

      if (message.tool_calls && message.tool_calls.length > 0) {
        console.log("\n🔧 Tool Calls Detected:");
        message.tool_calls.forEach((tool, idx) => {
          console.log(`   ${idx + 1}. ${tool.function.name}`);
          console.log("      Arguments:", tool.function.arguments);
        });
        console.log("\n✅ SUCCESS: Tool calling is working!");
      } else {
        console.log("\n⚠️  No tool calls in response");
      }
    }
  } catch (error) {
    console.error("\n❌ Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

await runJsonRequest("Test 1: Request with Tools (Weather Query)", {
  model: TEST_MODEL,
  messages: [
    {
      role: "user",
      content: "What is the weather like in San Francisco?",
    },
  ],
  tools,
  tool_choice: "auto",
});

await runJsonRequest("Test 2: Request with Tools (Math Calculation)", {
  model: TEST_MODEL,
  messages: [
    {
      role: "user",
      content: "Calculate 15 * 7 + 23",
    },
  ],
  tools,
  tool_choice: "auto",
});

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("📋 Test 3: Streaming Request with Tools");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

const streamRequest = {
  model: TEST_MODEL,
  messages: [
    {
      role: "user",
      content: "What is the weather in Tokyo? Use the weather tool.",
    },
  ],
  tools,
  tool_choice: "auto",
  stream: true,
};

console.log("📤 Request:", JSON.stringify(streamRequest, null, 2));

try {
  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(streamRequest),
  });

  console.log("\n📥 Response Status:", response.status);
  console.log("📥 Streaming response...\n");

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming response body reader unavailable");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let toolCallsDetected = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") {
          console.log("   [DONE]");
          continue;
        }

        try {
          const parsed = JSON.parse(data);
          console.log("   Chunk:", JSON.stringify(parsed, null, 2));

          if (parsed.choices) {
            for (const choice of parsed.choices) {
              const delta = choice.delta;
              if (delta?.tool_calls && delta.tool_calls.length > 0) {
                toolCallsDetected = true;
                delta.tool_calls.forEach((tool, idx) => {
                  console.log(`   🔧 Streaming tool call ${idx + 1}: ${tool.function?.name}`);
                  console.log("      Arguments:", tool.function?.arguments);
                });
              }
            }
          }
        } catch (error) {
          console.log("   (non-JSON chunk)", data);
          if (error instanceof Error) {
            console.log("   Error parsing chunk:", error.message);
          }
        }
      }
    }
  }

  if (toolCallsDetected) {
    console.log("\n✅ SUCCESS: Streaming tool calls detected!");
  } else {
    console.log("\n⚠️  No streaming tool calls detected");
  }
} catch (error) {
  console.error("\n❌ Error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
