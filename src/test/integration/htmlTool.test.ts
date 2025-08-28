import assert from "assert";

import { before, describe, it } from "mocha";

import { detectPotentialToolCall } from "../../handlers/toolCallHandler.js";
import { extractToolCallXMLParser } from "../../utils/xmlUtils.js";

import type { ToolCallDetectionResult, ExtractedToolCall } from "../../types/index.js";

const htmlToolContent: string = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- Comments with < and > characters -->
    <script>
        if (x < 10 && y > 5) {
            console.log("This would break XML validation");
        }
    </script>
    <style>
        body > div {
            color: red;
        }
    </style>
</head>
<body>
    <img src="image.jpg">
    <br>
    <input type="text">
</body>
</html>`;

function createOpenAIDeltaChunk(content: string): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-123",
    object: "chat.completion.chunk",
    created: Date.now(),
    model: "gpt-4",
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: null,
      },
    ],
  })}\n\n`;
}

describe("HTML in Tool Parameters Tests", function () {
  const chunks: string[] = [];

  before(function () {
    chunks.push(createOpenAIDeltaChunk("<insert_edit_into_file>\n"));
    chunks.push(
      createOpenAIDeltaChunk(
        "  <explanation>Add HTML content to the file</explanation>\n",
      ),
    );
    chunks.push(
      createOpenAIDeltaChunk("  <filePath>/path/to/file.html</filePath>\n"),
    );
    chunks.push(createOpenAIDeltaChunk("  <code>"));

    const chunkSize = 50;
    for (let i = 0; i < htmlToolContent.length; i += chunkSize) {
      const contentPiece = htmlToolContent.substring(
        i,
        Math.min(i + chunkSize, htmlToolContent.length),
      );
      chunks.push(createOpenAIDeltaChunk(contentPiece));
    }

    chunks.push(createOpenAIDeltaChunk("</code>\n"));
    chunks.push(createOpenAIDeltaChunk("</insert_edit_into_file>"));

    chunks.push("data: [DONE]\n\n");
  });

  describe("XML Parser with HTML in tool", function () {
    it("should correctly parse XML with HTML content", function () {
      let completeXml = "<insert_edit_into_file>\n";
      completeXml +=
        "  <explanation>Add HTML content to the file</explanation>\n";
      completeXml += "  <filePath>/path/to/file.html</filePath>\n";
      completeXml += "  <code>" + htmlToolContent + "</code>\n";
      completeXml += "</insert_edit_into_file>";

      const knownToolNames: string[] = ["insert_edit_into_file"];
      const result: ExtractedToolCall | null = extractToolCallXMLParser(completeXml, knownToolNames);

      assert.ok(result, "Result should not be null");
      assert.strictEqual(
        result.name,
        "insert_edit_into_file",
        "Tool name should match",
      );
      assert.ok(
        Object.keys(result.arguments as Record<string, unknown>).includes("code"),
        "Arguments should include code",
      );
      assert.ok(
        ((result.arguments as Record<string, unknown>).code as string).includes("<!DOCTYPE html>"),
        "HTML in code param should be preserved",
      );
      assert.ok(
        ((result.arguments as Record<string, unknown>).code as string).includes("if (x < 10 && y > 5)"),
        "JS comparison operators should be preserved",
      );
      assert.ok(
        (result.arguments as Record<string, unknown>).code.includes('<img src="image.jpg">'),
        "Self-closing HTML tags should be preserved",
      );
    });
  });

  describe("Accumulated buffer parsing with HTML in tool", function () {
    it("should correctly process and accumulate XML with HTML content", function () {
      const knownToolNames: string[] = ["insert_edit_into_file"];
      let buffer = "";
      let isComplete = false;
      let isPotential = false;
      let toolCallResult: ExtractedToolCall | null = null;

      for (let i = 0; i < chunks.length - 1; i++) {
        const chunk = chunks[i];
        const match = chunk.match(/data: (.*)\n\n/);
        if (match?.[1]) {
          try {
            const data = JSON.parse(match[1]);
            const contentDelta = data.choices?.[0]?.delta?.content;
            if (contentDelta) {
              buffer += contentDelta;

              const potential: ToolCallDetectionResult = detectPotentialToolCall(buffer, knownToolNames);
              isPotential = potential.isPotential;

              if (potential.isCompletedXml) {
                isComplete = true;
                try {
                  toolCallResult = extractToolCallXMLParser(
                    buffer,
                    knownToolNames,
                  );
                  break;
                } catch (_err: unknown) {
                  const errorMessage = _err instanceof Error ? _err.message : 'Unknown error';
                  console.log(
                    "Expected parse error during test:",
                    errorMessage,
                  );
                }
              }
            }
          } catch (_err: unknown) {
            const errorMessage = _err instanceof Error ? _err.message : 'Unknown error';
            console.log("Error during HTML tool test:", errorMessage);
          }
        }
      }

      assert.ok(buffer.length > 0, "Buffer should accumulate content");
      assert.ok(isPotential, "Should detect potential tool call");
      assert.ok(isComplete, "Should detect completed XML");
      assert.ok(toolCallResult, "Should successfully parse tool call");
      assert.strictEqual(
        toolCallResult.name,
        "insert_edit_into_file",
        "Tool name should match",
      );
      assert.ok(
        Object.keys(toolCallResult.arguments as Record<string, unknown>).includes("code"),
        "Arguments should include code",
      );
      assert.ok(
        (toolCallResult.arguments as Record<string, unknown>).code.includes("<!DOCTYPE html>"),
        "HTML content should be preserved",
      );
      assert.ok(
        (toolCallResult.arguments as Record<string, unknown>).code.includes("if (x < 10 && y > 5)"),
        "JS comparison operators should be preserved",
      );
    });
  });
});