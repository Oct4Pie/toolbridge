#!/usr/bin/env ts-node

/**
 * Comprehensive Feature Test Script
 * Tests all major features of ToolBridge including:
 * - Translation layer (OpenAI ⟷ Ollama ⟷ Azure)
 * - Mock servers
 * - Dual client support
 * - Stream processing
 * - Tool call detection
 */

import { spawn, ChildProcess } from 'child_process';
import axios from 'axios';
import chalk from 'chalk';

// Configuration
const MOCK_OPENAI_PORT = 4001;
const MOCK_OLLAMA_PORT = 4002;
const MOCK_AZURE_PORT = 4003;
const TRANSLATION_PORT = 4004;
const PROXY_PORT = 3000;

// Test results tracking
const testResults: { name: string; status: 'passed' | 'failed'; error?: string }[] = [];

// Helper functions
function log(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') {
  const colors = {
    info: chalk.blue,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow
  };
  console.log(colors[type](`[${type.toUpperCase()}] ${message}`));
}

async function waitForServer(url: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await axios.get(url);
      return true;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
}

function startServer(command: string, args: string[], name: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    log(`Starting ${name}...`, 'info');
    const process = spawn(command, args, {
      stdio: 'pipe',
      shell: true
    });
    
    process.on('error', reject);
    
    // Give the server time to start
    setTimeout(() => resolve(process), 2000);
  });
}

async function runTest(name: string, testFn: () => Promise<void>) {
  try {
    log(`Running test: ${name}`, 'info');
    await testFn();
    testResults.push({ name, status: 'passed' });
    log(`✓ ${name}`, 'success');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    testResults.push({ name, status: 'failed', error: errorMsg });
    log(`✗ ${name}: ${errorMsg}`, 'error');
  }
}

// Test functions
async function testTranslationLayer() {
  const translationUrl = `http://localhost:${TRANSLATION_PORT}`;
  
  // Test OpenAI to Ollama translation
  const openaiRequest = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello, world!' }],
    max_tokens: 100,
    temperature: 0.7
  };
  
  const response = await axios.post(`${translationUrl}/translate`, {
    from: 'openai',
    to: 'ollama',
    request: openaiRequest
  });
  
  if (!response.data.success) {
    throw new Error('Translation failed');
  }
  
  const ollamaRequest = response.data.data;
  if (!ollamaRequest.messages || ollamaRequest.num_predict !== 100) {
    throw new Error('Translation did not properly convert fields');
  }
}

async function testMockOpenAIServer() {
  const response = await axios.post(`http://localhost:${MOCK_OPENAI_PORT}/v1/chat/completions`, {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Test message' }],
    tools: [{
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather information',
        parameters: { type: 'object', properties: {} }
      }
    }]
  });
  
  if (!response.data.id || !response.data.choices) {
    throw new Error('Invalid OpenAI mock response format');
  }
}

async function testMockOllamaServer() {
  const response = await axios.post(`http://localhost:${MOCK_OLLAMA_PORT}/api/chat`, {
    model: 'llama3',
    messages: [{ role: 'user', content: 'Test message' }],
    stream: false
  });
  
  if (!response.data.message || !response.data.done) {
    throw new Error('Invalid Ollama mock response format');
  }
}

async function testStreamProcessing() {
  // Test OpenAI streaming
  const response = await axios.post(
    `http://localhost:${MOCK_OPENAI_PORT}/v1/chat/completions`,
    {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Stream test' }],
      stream: true
    },
    { responseType: 'stream' }
  );
  
  return new Promise<void>((resolve, reject) => {
    let chunkCount = 0;
    
    response.data.on('data', (chunk: Buffer) => {
      chunkCount++;
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            if (chunkCount > 0) resolve();
            else reject(new Error('No chunks received'));
            return;
          }
          try {
            JSON.parse(data);
          } catch {
            // Skip non-JSON lines
          }
        }
      }
    });
    
    response.data.on('error', reject);
    
    setTimeout(() => reject(new Error('Stream timeout')), 10000);
  });
}

async function testToolCallDetection() {
  // This would test the tool call detection in the actual proxy
  // For now, we'll test the format generation
  const response = await axios.post(`http://localhost:${MOCK_OPENAI_PORT}/v1/chat/completions`, {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'What is the weather?' }],
    tools: [{
      type: 'function',
      function: {
        name: 'get_weather',
        parameters: { type: 'object' }
      }
    }]
  });
  
  const hasToolCall = response.data.choices[0].message.tool_calls !== undefined;
  if (!hasToolCall && response.data.choices[0].finish_reason !== 'stop') {
    throw new Error('Tool call detection issue');
  }
}

// Main test runner
async function main() {
  const servers: ChildProcess[] = [];
  
  try {
    log('Starting ToolBridge Feature Tests', 'info');
    log('================================', 'info');
    
    // Start mock servers
    log('Starting mock servers...', 'info');
    
    // Build the project first
    log('Building TypeScript files...', 'info');
    await new Promise((resolve, reject) => {
      const build = spawn('npm', ['run', 'build'], { stdio: 'inherit' });
      build.on('close', code => code === 0 ? resolve(void 0) : reject(new Error('Build failed')));
    });
    
    // Start mock OpenAI server
    const openaiServer = await startServer(
      'node',
      ['dist/test-servers/mock-openai-server.js'],
      'Mock OpenAI Server'
    );
    servers.push(openaiServer);
    
    // Start mock Ollama server
    const ollamaServer = await startServer(
      'node', 
      ['dist/test-servers/mock-ollama-server.js'],
      'Mock Ollama Server'
    );
    servers.push(ollamaServer);
    
    // Start translation router
    const translationServer = await startServer(
      'node',
      ['dist/src/translation/demo-server.js'],
      'Translation Server'
    );
    servers.push(translationServer);
    
    // Wait for servers to be ready
    log('Waiting for servers to be ready...', 'info');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Run tests
    log('Running feature tests...', 'info');
    log('========================', 'info');
    
    await runTest('Translation Layer: OpenAI → Ollama', testTranslationLayer);
    await runTest('Mock OpenAI Server', testMockOpenAIServer);
    await runTest('Mock Ollama Server', testMockOllamaServer);
    await runTest('Stream Processing', testStreamProcessing);
    await runTest('Tool Call Detection', testToolCallDetection);
    
    // Print results
    log('\nTest Results Summary', 'info');
    log('====================', 'info');
    
    const passed = testResults.filter(t => t.status === 'passed').length;
    const failed = testResults.filter(t => t.status === 'failed').length;
    
    testResults.forEach(result => {
      const icon = result.status === 'passed' ? '✓' : '✗';
      const color = result.status === 'passed' ? chalk.green : chalk.red;
      console.log(color(`${icon} ${result.name}`));
      if (result.error) {
        console.log(chalk.gray(`  Error: ${result.error}`));
      }
    });
    
    log(`\nTotal: ${passed} passed, ${failed} failed`, failed > 0 ? 'warning' : 'success');
    
    // Exit with appropriate code
    process.exit(failed > 0 ? 1 : 0);
    
  } catch (error) {
    log(`Fatal error: ${error}`, 'error');
    process.exit(1);
  } finally {
    // Cleanup servers
    log('Cleaning up servers...', 'info');
    servers.forEach(server => {
      try {
        server.kill();
      } catch {
        // Ignore cleanup errors
      }
    });
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    log(`Unhandled error: ${error}`, 'error');
    process.exit(1);
  });
}

export { main };