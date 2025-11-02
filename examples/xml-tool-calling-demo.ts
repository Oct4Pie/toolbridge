/**
 * XML Tool Calling Demo
 *
 * This example demonstrates ToolBridge's core feature: enabling function calling
 * for LLMs that don't natively support it by using XML format.
 *
 * Requirements:
 * - ToolBridge running on http://localhost:3000
 * - Ollama running locally with qwen3:latest model
 *
 * Run: npx ts-node examples/xml-tool-calling-demo.ts
 */

import OpenAI from 'openai';

// Configure OpenAI client to use ToolBridge proxy
const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'ollama', // Dummy key (Ollama doesn't need authentication)
});

// Define tools using standard OpenAI format
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather information for a specific location',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City name (e.g., "San Francisco", "London")',
          },
          units: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: 'Temperature units',
          },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_database',
      description: 'Search for records in the database',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results',
          },
          include_deleted: {
            type: 'boolean',
            description: 'Include deleted records',
          },
        },
        required: ['query'],
      },
    },
  },
];

async function demonstrateToolCalling() {
  console.log('\n🎯 ToolBridge XML Tool Calling Demo');
  console.log('====================================\n');

  // Example 1: Simple tool call
  console.log('📍 Example 1: Simple Weather Query');
  console.log('-----------------------------------');

  try {
    const response1 = await client.chat.completions.create({
      model: 'qwen3:latest',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant. When using tools, output ONLY the XML.',
        },
        {
          role: 'user',
          content: 'What is the weather in San Francisco? Use the get_weather tool.',
        },
      ],
      tools,
      stream: false,
    });

    const message = response1.choices[0]?.message;

    if (message?.tool_calls) {
      console.log('✅ Tool call detected!');
      console.log('Tool:', message.tool_calls[0]?.function.name);
      console.log('Arguments:', message.tool_calls[0]?.function.arguments);
      console.log('Full tool_calls:', JSON.stringify(message.tool_calls, null, 2));
    } else {
      console.log('❌ No tool calls detected');
      console.log('Response:', message?.content);
    }
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n');

  // Example 2: Database search with multiple parameters
  console.log('📍 Example 2: Database Search');
  console.log('----------------------------');

  try {
    const response2 = await client.chat.completions.create({
      model: 'qwen3:latest',
      messages: [
        {
          role: 'user',
          content: 'Search for users named "John", limit to 10 results, and include deleted records. Use the search_database tool.',
        },
      ],
      tools,
      stream: false,
    });

    const message = response2.choices[0]?.message;

    if (message?.tool_calls) {
      console.log('✅ Tool call detected!');
      const args = JSON.parse(message.tool_calls[0]?.function.arguments ?? '{}');
      console.log('Query:', args.query);
      console.log('Limit:', args.limit);
      console.log('Include deleted:', args.include_deleted);
    } else {
      console.log('❌ No tool calls detected');
      console.log('Response:', message?.content);
    }
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n');

  // Example 3: Streaming tool call
  console.log('📍 Example 3: Streaming Tool Call');
  console.log('--------------------------------');

  try {
    const stream = await client.chat.completions.create({
      model: 'qwen3:latest',
      messages: [
        {
          role: 'user',
          content: 'Get weather for Tokyo in celsius. Use the get_weather tool.',
        },
      ],
      tools,
      stream: true,
    });

    let toolCallDetected = false;
    let fullToolCall: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall | undefined;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.tool_calls) {
        toolCallDetected = true;
        fullToolCall = delta.tool_calls[0];
        console.log('📦 Received streaming tool call chunk');
      }
    }

    if (toolCallDetected) {
      console.log('✅ Streaming tool call detected!');
      console.log('Tool:', fullToolCall?.function?.name);
      console.log('Arguments:', fullToolCall?.function?.arguments);
    } else {
      console.log('❌ No tool calls detected in stream');
    }
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n');

  // Example 4: Show what the LLM actually outputs (raw XML)
  console.log('📍 Example 4: Raw XML Output (what LLM generates)');
  console.log('------------------------------------------------');
  console.log('When you ask: "What is the weather in Paris?"');
  console.log('');
  console.log('The LLM outputs:');
  console.log('');
  console.log('<toolbridge:calls>');
  console.log('  <get_weather>');
  console.log('    <location>Paris</location>');
  console.log('    <units>celsius</units>');
  console.log('  </get_weather>');
  console.log('</toolbridge:calls>');
  console.log('');
  console.log('ToolBridge detects this and converts it to:');
  console.log('');
  console.log(JSON.stringify({
    id: 'call_abc123',
    type: 'function',
    function: {
      name: 'get_weather',
      arguments: '{"location":"Paris","units":"celsius"}',
    },
  }, null, 2));

  console.log('\n✨ Demo complete!\n');
}

// Mock function to simulate calling the weather API
function executeWeatherTool(args: { location: string; units?: string }) {
  console.log(`\n🌤️  Calling weather API for ${args.location}...`);
  return {
    location: args.location,
    temperature: 22,
    units: args.units ?? 'celsius',
    conditions: 'Partly cloudy',
    humidity: 65,
    wind_speed: 12,
  };
}

// Complete example with tool execution
async function completeToolCallExample() {
  console.log('\n🔄 Complete Tool Call Flow');
  console.log('==========================\n');

  const response = await client.chat.completions.create({
    model: 'qwen3:latest',
    messages: [
      {
        role: 'user',
        content: 'What is the weather in London? Use the get_weather tool.',
      },
    ],
    tools,
  });

  const message = response.choices[0]?.message;

  if (message?.tool_calls) {
    console.log('1️⃣ Client sent request with tools defined');
    console.log('2️⃣ ToolBridge injected XML instructions into system prompt');
    console.log('3️⃣ LLM generated XML tool call');
    console.log('4️⃣ ToolBridge detected and converted to tool_calls format');
    console.log('5️⃣ Client received tool call:', message.tool_calls[0]?.function.name);
    console.log('');

    // Execute the tool
    const toolCall = message.tool_calls[0];
    const args = JSON.parse(toolCall?.function.arguments ?? '{}');
    const result = executeWeatherTool(args);

    console.log('6️⃣ Client executes tool and gets result:', result);
    console.log('');
    console.log('7️⃣ Client sends result back to continue conversation...');

    // Send tool result back
    const followUpResponse = await client.chat.completions.create({
      model: 'qwen3:latest',
      messages: [
        {
          role: 'user',
          content: 'What is the weather in London?',
        },
        message,
        {
          role: 'tool',
          tool_call_id: toolCall?.id ?? '',
          content: JSON.stringify(result),
        },
      ],
      tools,
    });

    const finalMessage = followUpResponse.choices[0]?.message;
    console.log('8️⃣ LLM responds with natural language:', finalMessage?.content);
  }

  console.log('\n✅ Complete flow demonstrated!\n');
}

// Run the demo
if (require.main === module) {
  (async () => {
    try {
      await demonstrateToolCalling();
      await completeToolCallExample();
    } catch (error) {
      console.error('\n❌ Demo failed:', error);
      console.log('\nMake sure:');
      console.log('1. ToolBridge is running (npm start)');
      console.log('2. Ollama is running (ollama serve)');
      console.log('3. qwen3:latest model is available (ollama pull qwen3:latest)');
      process.exit(1);
    }
  })();
}

export { demonstrateToolCalling, completeToolCallExample };
