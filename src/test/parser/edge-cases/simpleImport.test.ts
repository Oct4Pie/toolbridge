import { expect } from "chai";
import { describe, it } from "mocha";

import { detectPotentialToolCall } from "../../../handlers/toolCallHandler.js";
import { extractToolCallXMLParser } from "../../../utils/xmlUtils.js";

import type { ToolCallDetectionResult } from "../../../types/index.js";

describe("Import Verification Tests", function () {
  it("should verify that core utility imports work correctly", function () {
    expect(extractToolCallXMLParser).to.be.a("function");
    expect(detectPotentialToolCall).to.be.a("function");

    const result: ToolCallDetectionResult = detectPotentialToolCall(
      "<search><query>test</query></search>",
      ["search"],
    );
    expect(result).to.not.be.null;
    expect(result.rootTagName).to.equal("search");
  });
});