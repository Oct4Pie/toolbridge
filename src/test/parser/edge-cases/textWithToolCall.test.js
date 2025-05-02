import { expect } from "chai";
import { describe, it } from "mocha";
import { extractToolCallXMLParser } from "../../../utils/xmlUtils.js";

describe("Testing XML extraction with surrounding text", function () {
  const testCases = [
    {
      name: "Text before XML",
      input: `I'll search the codebase for you:
  
  <search>
    <query>How to handle tool calls</query>
  </search>`,
      expectedToolName: "search",
    },
    {
      name: "Text after XML",
      input: `<search>
    <query>How to handle tool calls</query>
  </search>
  
  Let me explain the results.`,
      expectedToolName: "search",
    },
    {
      name: "Text before and after XML",
      input: `Let me help you with that:
  
  <search>
    <query>How to handle tool calls</query>
  </search>
  
  Now I'll analyze the results.`,
      expectedToolName: "search",
    },
  ];

  const knownToolNames = [
    "search",
    "run_code",
    "think",
    "replace_string_in_file",
    "insert_edit_into_file",
  ];

  testCases.forEach((testCase) => {
    it(`should extract tool calls correctly when there is ${testCase.name}`, function () {
      const result = extractToolCallXMLParser(testCase.input, knownToolNames);
      expect(result).to.not.be.null;
      expect(result.name).to.equal(testCase.expectedToolName);
    });
  });
});
