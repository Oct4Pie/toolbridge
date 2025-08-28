import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testFiles: string[] = [
  "../streaming/html-with-tool-calls.test.ts",
  "../regression/html-buffer-overflow.test.ts",
  "../unit/handlers/html-tag-detection.test.ts",
  "../unit/utils/buffer-size-limit.test.ts",
];

console.log("Running HTML buffer handling tests...");

try {
  for (const file of testFiles) {
    const filePath = path.resolve(__dirname, file);
    console.log(`\n---- Running tests in ${file} ----`);

    try {
      execSync(`npx mocha ${filePath} --experimental-modules`, {
        stdio: "inherit",
      });
      console.log(`✅ Tests passed in ${file}`);
    } catch (_err: unknown) {
      console.error(`❌ Tests failed in ${file}`);
      process.exit(1);
    }
  }

  console.log("\n✅ All HTML buffer handling tests passed!");
} catch (error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error("Error running tests:", errorMessage);
  process.exit(1);
}