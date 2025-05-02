import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const challengesDir = __dirname;
const generatedTestsDir = path.join(
  __dirname,
  "..",
  "parser",
  "generated-tests",
);

if (!fs.existsSync(generatedTestsDir)) {
  fs.mkdirSync(generatedTestsDir, { recursive: true });
}

function generateTestFromChallenge(challengePath) {
  try {
    const challengeContent = fs.readFileSync(challengePath, "utf8");
    const challenge = JSON.parse(challengeContent);

    const { content, error, timestamp } = challenge;

    if (!content) {
      console.log(`Skipping ${challengePath} - no content`);
      return;
    }

    const testFileName = `challenge_${timestamp}_test.js`;
    const testFilePath = path.join(generatedTestsDir, testFileName);

    let testFileContent = `// Auto-generated test from challenge captured at ${new Date(timestamp).toISOString()}
import { expect } from "chai";
import { describe, it } from "mocha";
import { extractToolCallXMLParser } from "../../../utils/xmlUtils.js";

describe("Generated Challenge Test - ${new Date(timestamp).toISOString()}", function() {
  const knownToolNames = ["search", "run_code", "think", "replace_string_in_file", "insert_edit_into_file", "get_errors"];
  
  it("should handle challenging XML pattern", function() {
    // This test was generated from a parsing challenge
    const challengingContent = ${JSON.stringify(content)};
    
    ${error ? "// This content previously caused an error: " + JSON.stringify(error.message) : ""}
    
    // Test parsing the challenging content
    let result;
    let parseError;
    
    try {
      result = extractToolCallXMLParser(challengingContent, knownToolNames);
    } catch (err) {
      parseError = err;
    }
    
    // We don't assert success/failure, but the parser shouldn't crash
    if (result) {
      expect(result).to.be.an('object');
      if (result.name) {
        expect(result.name).to.be.a('string');
        expect(knownToolNames).to.include(result.name);
      }
    } else if (parseError) {
      expect(parseError).to.be.an('error');
      expect(parseError.message).to.be.a('string');
    }
  });
});\n`;

    fs.writeFileSync(testFilePath, testFileContent);
    console.log(`Generated test file: ${testFilePath}`);
  } catch (err) {
    console.error(`Failed to generate test from ${challengePath}:`, err);
  }
}

function processAllChallenges() {
  const files = fs
    .readdirSync(challengesDir)
    .filter((file) => file.startsWith("challenge-") && file.endsWith(".json"));

  if (files.length === 0) {
    console.log("No challenge files found");
    return;
  }

  console.log(`Found ${files.length} challenge files`);

  files.forEach((file) => {
    generateTestFromChallenge(path.join(challengesDir, file));
  });

  const runnerContent = `// Auto-generated test runner for challenge tests
import { describe } from "mocha";

describe("Generated Challenge Tests", function() {
  // Import all generated test files
  ${files
    .map((file) => {
      const testFileName = `challenge_${file.replace("challenge-", "").replace(".json", "")}_test.js`;
      return `require('./${testFileName}');`;
    })
    .join("\n  ")}
});\n`;

  fs.writeFileSync(
    path.join(generatedTestsDir, "run-generated-tests.js"),
    runnerContent,
  );
  console.log("Generated test runner");
}

processAllChallenges();
