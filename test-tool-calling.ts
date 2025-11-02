#!/usr/bin/env ts-node
/**
 * Test script for tool calling through ToolBridge proxy
 * Tests Ollama → OpenAI streaming with tool call detection
 */

import axios from 'axios';

const PROXY_URL = 'http://localhost:3000';

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'create_file',
      description: 'Create a new file',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Name of the file' },
          content: { type: 'string', description: 'Content of the file' }
        },
        required: ['filename', 'content']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_in_terminal',
      description: 'Execute a terminal command',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command to execute' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_directory',
      description: 'Create a new directory',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path of the directory' }
        },
        required: ['path']
      }
    }
  }
];

async function testStreaming() {
  console.log('🧪 Testing STREAMING tool calling (Ollama → OpenAI)');
  console.log('='.repeat(60));

  const request = {
    model: 'gemma3:latest',
    messages: [
      {
        role: 'user',
        content: 'Create a file named "test.txt" with content "hello world"'
      }
    ],
    tools,
    stream: true
  };

  console.log('📤 Sending request to:', `${PROXY_URL}/v1/chat/completions`);
  console.log('🛠️  Tools:', tools.map(t => t.function.name).join(', '));
  console.log('');

  try {
    const response = await axios.post(`${PROXY_URL}/v1/chat/completions`, request, {
      responseType: 'stream',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    let fullResponse = '';
    let toolCallDetected = false;
    let toolCallData: any = null;

    console.log('📥 Receiving stream...\n');

    response.data.on('data', (chunk: Buffer) => {
      const chunkStr = chunk.toString();
      fullResponse += chunkStr;

      // Parse SSE chunks
      const lines = chunkStr.split('\n').filter(line => line.trim());
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.substring(6).trim();

          if (data === '[DONE]') {
            console.log('✅ Stream complete [DONE]');
            continue;
          }

          try {
            const parsed = JSON.parse(data);

            // Check for tool calls
            if (parsed.choices?.[0]?.delta?.tool_calls) {
              toolCallDetected = true;
              toolCallData = parsed.choices[0].delta.tool_calls;
              console.log('🔧 TOOL CALL DETECTED:');
              console.log(JSON.stringify(parsed.choices[0].delta.tool_calls, null, 2));
            }

            // Check for content
            if (parsed.choices?.[0]?.delta?.content) {
              process.stdout.write(parsed.choices[0].delta.content);
            }

            // Check for finish reason
            if (parsed.choices?.[0]?.finish_reason) {
              console.log(`\n\n✓ Finish reason: ${parsed.choices[0].finish_reason}`);
            }
          } catch (e) {
            // Not JSON, skip
          }
        }
      }
    });

    await new Promise((resolve, reject) => {
      response.data.on('end', resolve);
      response.data.on('error', reject);
    });

    console.log('\n' + '='.repeat(60));
    console.log('📊 STREAMING TEST RESULTS:');
    console.log(`  Tool call detected: ${toolCallDetected ? '✅ YES' : '❌ NO'}`);
    if (toolCallData) {
      console.log(`  Tool name: ${toolCallData[0]?.function?.name || 'N/A'}`);
      console.log(`  Arguments:`, toolCallData[0]?.function?.arguments || 'N/A');
    }
    console.log('='.repeat(60));

    return toolCallDetected;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('❌ Request failed:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Data:', error.response.data);
      }
    } else {
      console.error('❌ Error:', error);
    }
    return false;
  }
}

async function testNonStreaming() {
  console.log('\n\n🧪 Testing NON-STREAMING tool calling (Ollama → OpenAI)');
  console.log('='.repeat(60));

  const request = {
    model: 'gemma3:latest',
    messages: [
      {
        role: 'user',
        content: 'Create a file named "test.txt" with content "hello world"'
      }
    ],
    tools,
    stream: false
  };

  console.log('📤 Sending request to:', `${PROXY_URL}/v1/chat/completions`);
  console.log('🛠️  Tools:', tools.map(t => t.function.name).join(', '));
  console.log('');

  try {
    const response = await axios.post(`${PROXY_URL}/v1/chat/completions`, request, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('📥 Response received\n');

    const hasToolCalls = response.data.choices?.[0]?.message?.tool_calls?.length > 0;

    if (hasToolCalls) {
      console.log('🔧 TOOL CALL DETECTED:');
      console.log(JSON.stringify(response.data.choices[0].message.tool_calls, null, 2));
    } else if (response.data.choices?.[0]?.message?.content) {
      console.log('💬 Content:', response.data.choices[0].message.content);
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 NON-STREAMING TEST RESULTS:');
    console.log(`  Tool call detected: ${hasToolCalls ? '✅ YES' : '❌ NO'}`);
    if (hasToolCalls) {
      const toolCall = response.data.choices[0].message.tool_calls[0];
      console.log(`  Tool name: ${toolCall.function.name}`);
      console.log(`  Arguments:`, toolCall.function.arguments);
    }
    console.log('='.repeat(60));

    return hasToolCalls;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('❌ Request failed:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Data:', JSON.stringify(error.response.data, null, 2));
      }
    } else {
      console.error('❌ Error:', error);
    }
    return false;
  }
}

async function main() {
  console.log('🚀 ToolBridge Tool Calling Test Suite\n');

  const streamingResult = await testStreaming();
  const nonStreamingResult = await testNonStreaming();

  console.log('\n\n' + '='.repeat(60));
  console.log('🎯 FINAL RESULTS:');
  console.log('='.repeat(60));
  console.log(`  Streaming mode:     ${streamingResult ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Non-streaming mode: ${nonStreamingResult ? '✅ PASS' : '❌ FAIL'}`);
  console.log('='.repeat(60));

  if (streamingResult && nonStreamingResult) {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
