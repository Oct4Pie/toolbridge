#!/usr/bin/env node

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");
const testDir = path.join(projectRoot, "src", "test");
const mochaPath = path.join(projectRoot, "node_modules", ".bin", "mocha");

console.log("===== Running All Tests Sequentially =====");

const getAllTestFiles = (dir: string): string[] => {
  let results: string[] = [];
  const list = fs.readdirSync(dir);

  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      results = results.concat(getAllTestFiles(filePath));
    } else if (file.endsWith(".test.js") || file.endsWith(".test.ts")) {
      results.push(filePath);
    }
  });

  return results;
};

const testFiles = getAllTestFiles(testDir);

console.log(`Found ${testFiles.length} test files.`);

let passed = 0;
let failed = 0;

const errorFiles: string[] = [];

testFiles.forEach((file) => {
  const relativePath = path.relative(projectRoot, file);
  console.log(`\nRunning test: ${relativePath}`);

  const result = spawnSync(mochaPath, [file], {
    stdio: "inherit",
  });

  if (result.status === 0) {
    passed++;
    console.log(`✅ Passed: ${relativePath}`);
  } else {
    failed++;
    errorFiles.push(relativePath);
    console.log(`❌ Failed: ${relativePath}`);
  }
});

console.log("\n===== Test Summary =====");
console.log(`Total test files: ${testFiles.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Pass rate: ${Math.round((passed / testFiles.length) * 100)}%`);

if (failed > 0) {
  console.log("\nFiles with failures:");
  errorFiles.forEach((file) => {
    console.log(`- ${file}`);
  });
}

process.exit(failed > 0 ? 1 : 0);