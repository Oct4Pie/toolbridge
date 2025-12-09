import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import Mocha from "mocha";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDir = path.resolve(__dirname, "..");

const mocha = new Mocha({
  timeout: 10000,
  reporter: "spec",
});

const testPatterns: string[] = [
  "unit/handlers/toolCallHandler.test.ts",
  "unit/utils/xmlUtils.test.ts",

  "integration/toolCallStreaming.test.ts",
  "integration/htmlTool.test.ts",

  "parser/tool-calls/edgeCases.test.ts",
  "parser/tool-calls/regression.test.ts",
];

testPatterns.forEach((pattern: string) => {
  const fullPath = path.join(testDir, pattern);
  if (fs.existsSync(fullPath)) {
    mocha.addFile(fullPath);
    console.log(`Added test file: ${pattern}`);
  } else {
    console.warn(`Warning: Test file not found: ${pattern}`);
  }
});

console.log("Running tool call tests...");
mocha.run((failures: number) => {
  process.exitCode = failures ? 1 : 0;
});