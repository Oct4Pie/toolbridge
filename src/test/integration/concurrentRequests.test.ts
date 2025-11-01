import { createServer } from "http";

import { expect } from "chai";
import express from "express";
import { describe, it } from "mocha";

import chatCompletionsHandler from "../../handlers/chatHandler.js";
import { extractToolCallXMLParser } from "../../parsers/xml/index.js";

import type { ExtractedToolCall } from "../../types/index.js";
import type { Application } from "express";
import type { Server } from "http";

interface ParsingTestResult {
  success: boolean;
  result?: ExtractedToolCall | null;
  error?: string;
}

describe("Concurrent Request Handling", function () {
  this.timeout(15000);

  it("should handle multiple concurrent tool call parsing requests", async function () {
    const app: Application = express();
    app.use(express.json());
    app.post("/v1/chat/completions", chatCompletionsHandler);

    const server: Server = createServer(app);
  await new Promise<void>((resolve, reject) => server.listen(0, (err?: Error | undefined) => err ? reject(err) : resolve()));

    const toolCallXMLs: string[] = [
      `<search><query>typescript generics</query></search>`,
      `<think><thoughts>I need to analyze the performance implications</thoughts></think>`,
      `<run_code><language>javascript</language><code>console.log("Hello");</code></run_code>`,
      `<search><query>react hooks useEffect</query></search>`,
      `<run_code><language>python</language><code>print("Hello world")</code></run_code>`,
      `<search><query>graphql vs rest</query></search>`,
      `<think><thoughts>Let me analyze this algorithm complexity...</thoughts></think>`,
      `<replace_string_in_file><filePath>test.js</filePath><oldString>var x=1;</oldString><newString>const x=1;</newString></replace_string_in_file>`,
      `<insert_edit_into_file><filePath>app.js</filePath><code>// New code here</code><explanation>Adding comment</explanation></insert_edit_into_file>`,
      `<get_errors><filePaths>["index.js"]</filePaths></get_errors>`,
    ];

    const knownToolNames: string[] = [
      "search",
      "run_code",
      "think",
      "replace_string_in_file",
      "insert_edit_into_file",
      "get_errors",
    ];

    const concurrentParsingTests: Promise<ParsingTestResult>[] = Array(50)
      .fill(0)
      .map(async (_, index) => {
        const xml = toolCallXMLs[index % toolCallXMLs.length];
        return new Promise<ParsingTestResult>((resolve) => {
          try {
            const result = extractToolCallXMLParser(xml, knownToolNames);
            resolve({ success: true, result });
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            resolve({ success: false, error: errorMessage });
          }
        });
      });

    const parsingResults: ParsingTestResult[] = await Promise.all(concurrentParsingTests);

    const successfulTests = parsingResults.filter((r) => r.success).length;

    expect(successfulTests / parsingResults.length).to.be.at.least(0.95);

  await new Promise<void>((resolve, reject) => server.close((err?: Error | undefined) => err ? reject(err) : resolve()));
  });
});