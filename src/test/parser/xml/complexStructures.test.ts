import assert from "assert";

import { describe, it } from "mocha";

import { extractToolCallXMLParser } from "../../../utils/xmlUtils.js";
import { extractToolCallFromWrapper } from "../../../utils/xmlToolParser.js";

describe("Complex XML Tool Call Parsing", function () {
  const tools = [
    "plan_trip",
    "generate_document",
    "transform_data",
    "extremely_complex_tool",
    "ns_prefixed_tool",
    "array_tool",
    "html_payload_tool",
  ];

  it("parses deeply nested objects with arrays and mixed types", function () {
    const xml = `
<plan_trip>
  <traveler>
    <name>Jane Doe</name>
    <age>34</age>
    <preferences>
      <likes>ramen</likes>
      <likes>sushi</likes>
      <likes>museums</likes>
      <newsletter>true</newsletter>
    </preferences>
  </traveler>
  <destination>
    <city>Tokyo</city>
    <country>Japan</country>
  </destination>
  <dates>
    <start>2025-09-10</start>
    <end>2025-09-20</end>
  </dates>
  <activities>
    <item>
      <type>tour</type>
      <cost>120.5</cost>
      <options>
        <guide>true</guide>
        <language>en</language>
      </options>
    </item>
    <item>
      <type>food</type>
      <cost>75</cost>
      <options>
        <vegetarian>false</vegetarian>
      </options>
    </item>
  </activities>
  <notes><![CDATA[Bring JR Pass <not-a-tag> & sunscreen]]></notes>
</plan_trip>`;

    const parsed = extractToolCallXMLParser(xml, tools);
    assert.ok(parsed, "Expected tool call to parse");
    assert.strictEqual(parsed!.name, "plan_trip");
    const args = parsed!.arguments as Record<string, unknown>;
    assert.strictEqual((args.traveler as any).name, "Jane Doe");
    assert.strictEqual((args.traveler as any).preferences.newsletter, true);
    assert.strictEqual((args.destination as any).city, "Tokyo");
    assert.strictEqual((args.activities as any[]).length, 2);
    assert.strictEqual(args.notes, "Bring JR Pass <not-a-tag> & sunscreen");
  });

  it("treats known raw text params (code/html/markdown/md/body) as verbatim", function () {
    const xml = `
<generate_document>
  <title>Report</title>
  <markdown># Heading\n\nSome **bold** text</markdown>
  <code>function add(a, b) { return a + b; }</code>
  <html><!DOCTYPE html><div class="x"><script>if (x<10) alert(1)</script></div></html>
</generate_document>`;

    const parsed = extractToolCallXMLParser(xml, tools)!;
    const args = parsed.arguments as Record<string, unknown>;
    assert.ok(String(args.markdown).includes("**bold**"));
    assert.ok(String(args.code).includes("function add"));
    assert.ok(String(args.html).includes("<!DOCTYPE html>"));
    assert.ok(String(args.html).includes("<script>"));
  });

  it("supports arrays via repeated tags and nested arrays of objects", function () {
    const xml = `
<array_tool>
  <tags>alpha</tags>
  <tags>beta</tags>
  <tags>gamma</tags>
  <items>
    <entry><id>1</id><name>A</name></entry>
    <entry><id>2</id><name>B</name></entry>
  </items>
</array_tool>`;

    const parsed = extractToolCallXMLParser(xml, tools)!;
    const args = parsed.arguments as Record<string, unknown>;
    assert.deepStrictEqual(args.tags, ["alpha", "beta", "gamma"]);
    assert.strictEqual((args.items as any).entry.length, 2);
    assert.strictEqual((args.items as any).entry[0].id, 1);
  });

  it("extracts from wrapper with additional surrounding text", function () {
    const content = `Intro text before\n<toolbridge:calls>\n  <transform_data>\n    <json>{\n      \"name\": \"ACME\", \n      \"count\": 3\n    }</json>\n    <operations>normalize</operations>\n    <operations>dedupe</operations>\n  </transform_data>\n</toolbridge:calls>\nTrailing text after`;

    const parsed = extractToolCallFromWrapper(content, tools)!;
    assert.strictEqual(parsed.name, "transform_data");
    const args = parsed.arguments as Record<string, unknown>;
    assert.ok(String(args.json).includes("\"ACME\""));
    assert.deepStrictEqual(args.operations, ["normalize", "dedupe"]);
  });

  it("handles namespace prefixes on the tool tag", function () {
    const xml = `
<ns:ns_prefixed_tool>
  <value>42</value>
</ns:ns_prefixed_tool>`;

    const parsed = extractToolCallXMLParser(xml, tools);
    assert.ok(parsed, "Expected namespaced tool to parse");
    assert.strictEqual(parsed!.name, "ns_prefixed_tool");
    assert.strictEqual((parsed!.arguments as any).value, 42);
  });

  it("withstands very large payloads inside raw body param without truncation", function () {
    const large = "x".repeat(5000);
    const xml = `
<html_payload_tool>
  <body>${large}</body>
</html_payload_tool>`;

    const parsed = extractToolCallXMLParser(xml, tools)!;
    const args = parsed.arguments as Record<string, unknown>;
    assert.strictEqual(String(args.body).length, large.length);
  });

  it("parses extremely complex nested structures", function () {
    const xml = `
<extremely_complex_tool>
  <a>
    <b>
      <c>
        <d>
          <e>
            <f>true</f>
            <arr>1</arr>
            <arr>2</arr>
            <arr>3</arr>
            <obj>
              <k1>v1</k1>
              <k2>
                <inner>5.5</inner>
                <inner>false</inner>
              </k2>
            </obj>
          </e>
        </d>
      </c>
    </b>
  </a>
</extremely_complex_tool>`;

    const parsed = extractToolCallXMLParser(xml, tools)!;
    const args = parsed.arguments as Record<string, unknown>;
    const e = (((args as any).a).b).c.d.e;
    assert.strictEqual(e.f, true);
    assert.deepStrictEqual(e.arr, [1, 2, 3]);
    assert.strictEqual(e.obj.k1, "v1");
    assert.deepStrictEqual(e.obj.k2.inner, [5.5, false]);
  });
});
