import { execSync } from "child_process";
import fs from "fs";
import path from "path";

interface TestResult {
  file: string;
  passed?: number;
  total?: number;
  percentage?: number;
  error?: boolean;
  errorMessage?: string;
}

interface TestResults {
  total: number;
  passed: number;
  failed: number;
  tests: TestResult[];
}

const testDir = path.join(process.cwd(), "src", "test");
const llmPatternsDir = path.join(testDir, "parser", "llm-patterns");
const testResults: TestResults = {
  total: 0,
  passed: 0,
  failed: 0,
  tests: [],
};

console.log("=== LLM Output Pattern Tests ===");
console.log("Testing how the parser handles realistic LLM output patterns\n");

let testFiles: string[] = [];
try {
  testFiles = fs
    .readdirSync(llmPatternsDir)
    .filter((file: string) => file.endsWith(".test.js") || file.endsWith(".test.ts"))
    .map((file: string) => path.join("parser", "llm-patterns", file));
} catch (err: unknown) {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(`Error reading directory ${llmPatternsDir}:`, error.message);
  process.exit(1);
}

if (testFiles.length === 0) {
  console.log("No test files found!");
  process.exit(0);
}

console.log(`Found ${testFiles.length} test file(s):\n`);

for (const relativeFilePath of testFiles) {
  const filePath = path.join(testDir, relativeFilePath);
  const displayPath = relativeFilePath;

  console.log(`Running test: ${displayPath}...`);
  try {
    const output = execSync(`node ${filePath}`, { encoding: "utf-8" });

    const resultMatch = output.match(
      /FINAL RESULTS: (\d+)\/(\d+) tests passed/,
    );

    if (resultMatch) {
      const passed = parseInt(resultMatch[1], 10);
      const total = parseInt(resultMatch[2], 10);
      const failed = total - passed;

      testResults.total += total;
      testResults.passed += passed;
      testResults.failed += failed;

      const passingPercentage = Math.round((passed / total) * 100);

      testResults.tests.push({
        file: displayPath,
        passed,
        total,
        percentage: passingPercentage,
      });

      console.log(`  ${passingPercentage}% passed (${passed}/${total})`);
    } else {
      console.log(`  ⚠️ Could not parse test results from output`);
    }
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(
      `  ❌ Error running test file ${displayPath}:`,
      err.message,
    );
    testResults.tests.push({
      file: displayPath,
      error: true,
      errorMessage: err.message,
    });
  }
}

console.log("\n=== LLM Pattern Test Results Summary ===");
console.log(`Total tests: ${testResults.total}`);
console.log(`Passed: ${testResults.passed}`);
console.log(`Failed: ${testResults.failed}`);

const overallPercentage =
  testResults.total > 0
    ? Math.round((testResults.passed / testResults.total) * 100)
    : 0;

console.log(`Overall passing rate: ${overallPercentage}%`);

console.log("\nDetailed Results:");
for (const result of testResults.tests) {
  if (result.error) {
    console.log(`❌ ${result.file}: ERROR - ${result.errorMessage}`);
  } else {
    const icon =
      result.percentage === 100 ? "✅" : (result.percentage !== null && result.percentage !== undefined && result.percentage >= 80) ? "⚠️" : "❌";
    console.log(
      `${icon} ${result.file}: ${result.percentage}% (${result.passed}/${result.total})`,
    );
  }
}

process.exit(testResults.failed > 0 ? 1 : 0);