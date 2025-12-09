#!/usr/bin/env node
/**
 * Sequential Integration Test Runner
 * 
 * Runs integration tests ONE AT A TIME to avoid port conflicts.
 * Each test gets its own port via the port manager.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const integrationTests = [
  'comprehensive-tool-calling.test.js',
  'brutality.test.js',
  'bidirectional-conversion.test.js',
  'comprehensive-real-clients.test.js',
  'real-clients-xml-toolcalls.test.js',
  'end-to-end-real-client.test.js',
];

const testDir = path.join(__dirname, '../integration');

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  🧪 Running Integration Tests Sequentially                  ║');
console.log('║  Each test gets a unique port to avoid conflicts            ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');

let totalPassed = 0;
let totalFailed = 0;
let totalPending = 0;

for (const testFile of integrationTests) {
  const testPath = path.join(testDir, testFile);
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Running: ${testFile}`);
  console.log('='.repeat(70));
  
  try {
    const output = execSync(`npx mocha "${testPath}" --reporter spec`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: {
        ...process.env,
        // Each test will request its own port from port manager
      }
    });
    
    console.log(output);
    
    // Parse results
    const passingMatch = output.match(/(\d+) passing/);
    const failingMatch = output.match(/(\d+) failing/);
    const pendingMatch = output.match(/(\d+) pending/);
    
    if (passingMatch?.[1]) totalPassed += parseInt(passingMatch[1], 10);
    if (failingMatch?.[1]) totalFailed += parseInt(failingMatch[1], 10);
    if (pendingMatch?.[1]) totalPending += parseInt(pendingMatch[1], 10);
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${testFile}`);
    if (error instanceof Error && 'stdout' in error) {
      console.log((error as {stdout: Buffer}).stdout.toString());
    }
    if (error instanceof Error && 'stderr' in error) {
      console.error((error as {stderr: Buffer}).stderr.toString());
    }
    
    // Try to extract failing count
    const errorOutput = error instanceof Error && 'stdout' in error 
      ? (error as {stdout: Buffer}).stdout.toString()
      : '';
    const failingMatch = errorOutput.match(/(\d+) failing/);
    if (failingMatch?.[1]) {
      totalFailed += parseInt(failingMatch[1], 10);
    } else {
      totalFailed += 1; // Count the whole test as failed
    }
  }
}

console.log('\n');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  📊 Final Results                                            ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log(`✅ Passing:  ${totalPassed}`);
console.log(`❌ Failing:  ${totalFailed}`);
console.log(`⏭️  Pending:  ${totalPending}`);
console.log('');

if (totalFailed > 0) {
  process.exit(1);
}
