import * as assert from "assert";

import { describe, it } from "mocha";

import { extractToolCallFromWrapper, extractToolCall } from "../../../parsers/xml/index.js";

/**
 * Tests for JSON-formatted parameters inside XML tool tags
 * 
 * Critical Fix: Handles both formats:
 * - XML format: <tool_name><param>value</param></tool_name>
 * - JSON format: <tool_name>{"param":"value"}</tool_name>
 */
describe("JSON Parameters in XML Tool Calls", function () {
  const tools = ["create_directory", "write_file", "complex_tool", "api_call"];

  describe("Wrapper-based extraction (toolbridge_calls)", function () {
    it("parses simple JSON object inside tool tag", function () {
      const xml = `<toolbridge_calls><create_directory>{"path":"/tmp"}</create_directory></toolbridge_calls>`;
      const parsed = extractToolCallFromWrapper(xml, tools);
      
      assert.ok(parsed, "Expected tool call to parse");
      assert.strictEqual(parsed.name, "create_directory");
      assert.strictEqual((parsed.arguments as Record<string, unknown>)['path'], "/tmp");
    });

    it("parses JSON with multiple parameters", function () {
      const xml = `<toolbridge_calls><write_file>{"path":"/tmp/test.txt","content":"Hello World","mode":"644"}</write_file></toolbridge_calls>`;
      const parsed = extractToolCallFromWrapper(xml, tools);
      
      assert.ok(parsed, "Expected tool call to parse");
      assert.strictEqual(parsed.name, "write_file");
      const args = parsed.arguments as Record<string, unknown>;
      assert.strictEqual(args['path'], "/tmp/test.txt");
      assert.strictEqual(args['content'], "Hello World");
      assert.strictEqual(args['mode'], "644");
    });

    it("parses nested JSON object", function () {
      const xml = `<toolbridge_calls><complex_tool>{"config":{"host":"localhost","port":8080},"enabled":true}</complex_tool></toolbridge_calls>`;
      const parsed = extractToolCallFromWrapper(xml, tools);
      
      assert.ok(parsed, "Expected tool call to parse");
      assert.strictEqual(parsed.name, "complex_tool");
      const args = parsed.arguments as Record<string, unknown>;
      const config = args['config'] as Record<string, unknown>;
      assert.strictEqual(config['host'], "localhost");
      assert.strictEqual(config['port'], 8080);
      assert.strictEqual(args['enabled'], true);
    });

    it("parses JSON with arrays", function () {
      const xml = `<toolbridge_calls><api_call>{"endpoints":["/api/v1","/api/v2"],"methods":["GET","POST"]}</api_call></toolbridge_calls>`;
      const parsed = extractToolCallFromWrapper(xml, tools);
      
      assert.ok(parsed, "Expected tool call to parse");
      assert.strictEqual(parsed.name, "api_call");
      const args = parsed.arguments as Record<string, unknown>;
      assert.deepStrictEqual(args['endpoints'], ["/api/v1", "/api/v2"]);
      assert.deepStrictEqual(args['methods'], ["GET", "POST"]);
    });

    it("parses JSON with different data types", function () {
      const xml = `<toolbridge_calls><complex_tool>{"string":"test","number":42,"boolean":true,"null_value":null}</complex_tool></toolbridge_calls>`;
      const parsed = extractToolCallFromWrapper(xml, tools);
      
      assert.ok(parsed, "Expected tool call to parse");
      const args = parsed.arguments as Record<string, unknown>;
      assert.strictEqual(args['string'], "test");
      assert.strictEqual(args['number'], 42);
      assert.strictEqual(args['boolean'], true);
      assert.strictEqual(args['null_value'], null);
    });

    it("parses JSON with whitespace and newlines", function () {
      const xml = `<toolbridge_calls><create_directory>{
  "path": "/tmp/test",
  "recursive": true
}</create_directory></toolbridge_calls>`;
      const parsed = extractToolCallFromWrapper(xml, tools);
      
      assert.ok(parsed, "Expected tool call to parse");
      const args = parsed.arguments as Record<string, unknown>;
      assert.strictEqual(args['path'], "/tmp/test");
      assert.strictEqual(args['recursive'], true);
    });

    it("handles empty JSON object", function () {
      const xml = `<toolbridge_calls><create_directory>{}</create_directory></toolbridge_calls>`;
      const parsed = extractToolCallFromWrapper(xml, tools);
      
      assert.ok(parsed, "Expected tool call to parse");
      assert.strictEqual(parsed.name, "create_directory");
      assert.deepStrictEqual(parsed.arguments, {});
    });

    it("gracefully falls back to XML parsing for invalid JSON", function () {
      const xml = `<toolbridge_calls><create_directory>{invalid json}</create_directory></toolbridge_calls>`;
      const parsed = extractToolCallFromWrapper(xml, tools);
      
      // Should still return something (falls back to treating as text)
      assert.ok(parsed !== null, "Should not crash on invalid JSON");
    });
  });

  describe("Direct XML parser (without wrapper)", function () {
    it("parses simple JSON object", function () {
      const xml = `<create_directory>{"path":"/tmp"}</create_directory>`;
      const parsed = extractToolCall(xml, tools);
      
      assert.ok(parsed, "Expected tool call to parse");
      assert.strictEqual(parsed.name, "create_directory");
      assert.strictEqual((parsed.arguments as Record<string, unknown>)['path'], "/tmp");
    });

    it("parses complex nested JSON", function () {
      const xml = `<complex_tool>{"data":{"items":[1,2,3],"metadata":{"count":3}}}</complex_tool>`;
      const parsed = extractToolCall(xml, tools);
      
      assert.ok(parsed, "Expected tool call to parse");
      const args = parsed.arguments as Record<string, unknown>;
      const data = args['data'] as Record<string, unknown>;
      assert.deepStrictEqual(data['items'], [1, 2, 3]);
      const metadata = data['metadata'] as Record<string, unknown>;
      assert.strictEqual(metadata['count'], 3);
    });
  });

  describe("Backward compatibility - XML format still works", function () {
    it("still parses traditional XML parameters", function () {
      const xml = `<toolbridge_calls><create_directory><path>/tmp</path></create_directory></toolbridge_calls>`;
      const parsed = extractToolCallFromWrapper(xml, tools);
      
      assert.ok(parsed, "Expected tool call to parse");
      assert.strictEqual(parsed.name, "create_directory");
      assert.strictEqual((parsed.arguments as Record<string, unknown>)['path'], "/tmp");
    });

    it("parses nested XML structures", function () {
      const xml = `<toolbridge_calls><write_file><path>/tmp/test.txt</path><content>Hello</content></write_file></toolbridge_calls>`;
      const parsed = extractToolCallFromWrapper(xml, tools);
      
      assert.ok(parsed, "Expected tool call to parse");
      const args = parsed.arguments as Record<string, unknown>;
      assert.strictEqual(args['path'], "/tmp/test.txt");
      assert.strictEqual(args['content'], "Hello");
    });

    it("parses repeated XML tags as arrays", function () {
      const xml = `<toolbridge_calls><api_call><method>GET</method><method>POST</method></api_call></toolbridge_calls>`;
      const parsed = extractToolCallFromWrapper(xml, tools);
      
      assert.ok(parsed, "Expected tool call to parse");
      const args = parsed.arguments as Record<string, unknown>;
      assert.deepStrictEqual(args['method'], ["GET", "POST"]);
    });
  });

  describe("Edge cases and special characters", function () {
    it("handles JSON with escaped quotes", function () {
      const xml = `<toolbridge_calls><write_file>{"content":"He said \\"hello\\""}</write_file></toolbridge_calls>`;
      const parsed = extractToolCallFromWrapper(xml, tools);
      
      assert.ok(parsed, "Expected tool call to parse");
      const args = parsed.arguments as Record<string, unknown>;
      assert.strictEqual(args['content'], 'He said "hello"');
    });

    it("handles JSON with newlines and tabs", function () {
      const xml = `<toolbridge_calls><write_file>{"content":"Line1\\nLine2\\tTabbed"}</write_file></toolbridge_calls>`;
      const parsed = extractToolCallFromWrapper(xml, tools);
      
      assert.ok(parsed, "Expected tool call to parse");
      const args = parsed.arguments as Record<string, unknown>;
      assert.strictEqual(args['content'], "Line1\nLine2\tTabbed");
    });

    it("handles JSON with Unicode characters", function () {
      const xml = `<toolbridge_calls><write_file>{"content":"Hello 世界 🌍"}</write_file></toolbridge_calls>`;
      const parsed = extractToolCallFromWrapper(xml, tools);
      
      assert.ok(parsed, "Expected tool call to parse");
      const args = parsed.arguments as Record<string, unknown>;
      assert.strictEqual(args['content'], "Hello 世界 🌍");
    });
  });
});
