#!/usr/bin/env ts-node

/**
 * Quick Server Test
 * Tests the mock servers individually
 */

import { spawn } from 'child_process';

import axios from 'axios';

async function testServer(name: string, port: number, endpoint: string, payload: any) {
  console.log(`\nTesting ${name} on port ${port}...`);
  
  try {
    const response = await axios.post(`http://localhost:${port}${endpoint}`, payload, {
      timeout: 5000,
      validateStatus: () => true // Accept any status
    });
    
    console.log(`✅ ${name} responded with status ${response.status}`);
    console.log(`Response data sample:`, JSON.stringify(response.data).substring(0, 200));
    return true;
  } catch (error: any) {
    console.log(`❌ ${name} failed:`, error.message);
    return false;
  }
}

async function main() {
  console.log('Starting server tests...');
  
  // Build first
  console.log('\n🔨 Building TypeScript files...');
  await new Promise((resolve, reject) => {
    const build = spawn('npm', ['run', 'build'], { stdio: 'inherit' });
    build.on('close', code => code === 0 ? resolve(void 0) : reject(new Error('Build failed')));
  });
  
  // Start servers
  const servers = [];
  
  console.log('\n🚀 Starting Mock OpenAI server...');
  const openai = spawn('node', ['dist/test-servers/mock-openai-server.js'], {
    env: { ...process.env, PORT: '3001' }
  });
  servers.push(openai);
  
  console.log('🚀 Starting Mock Ollama server...');
  const ollama = spawn('node', ['dist/test-servers/mock-ollama-server.js'], {
    env: { ...process.env }
  });
  servers.push(ollama);
  
  // Wait for servers to start
  console.log('\n⏳ Waiting for servers to initialize...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Test each server
  const results = [];
  
  results.push(await testServer('Mock OpenAI', 3001, '/v1/chat/completions', {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello!' }]
  }));
  
  results.push(await testServer('Mock Ollama', 11434, '/api/chat', {
    model: 'llama3',
    messages: [{ role: 'user', content: 'Hello!' }]
  }));
  
  // Summary
  console.log('\n📊 Test Summary:');
  console.log('================');
  const passed = results.filter(r => r).length;
  const failed = results.filter(r => !r).length;
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  
  // Cleanup
  console.log('\n🧹 Cleaning up servers...');
  servers.forEach(server => server.kill());
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});