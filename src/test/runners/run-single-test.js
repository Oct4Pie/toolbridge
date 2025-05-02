import { execSync } from "child_process";
import path from "path";

const testDir = path.join(process.cwd(), "src", "test");

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    "Please provide a test file path relative to the src/test directory.",
  );
  console.error(
    "Example: node run-single-test.js parser/llm-patterns/fuzzyContent.test.js",
  );
  process.exit(1);
}

const relativePath = args[0];
const fullPath = path.join(testDir, relativePath);

console.log(`=== Running specific test: ${relativePath} ===`);

try {
  const output = execSync(`node ${fullPath}`, {
    encoding: "utf-8",
    stdio: "inherit",
  });

  console.log(output);
  process.exit(0);
} catch (error) {
  console.error(`Error running test: ${error.message}`);
  process.exit(1);
}
