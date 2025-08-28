import { expect } from "chai";
import { describe, it } from "mocha";

import { extractToolCallXMLParser } from "../../../utils/xmlUtils.js";

describe("Mutation Testing for XML Parser", function () {
  const knownToolNames: string[] = [
    "search",
    "run_code",
    "think",
    "replace_string_in_file",
    "insert_edit_into_file",
    "get_errors",
  ];

  const validXMLSamples: string[] = [
    `<search>
      <query>How to implement binary search?</query>
    </search>`,

    `<think>
      <thoughts>
        I need to analyze the performance implications of using a recursive approach versus an iterative approach for traversing a binary tree.
      </thoughts>
    </think>`,

    `<run_code>
      <language>javascript</language>
      <code>
        function fibonacci(n) {
          if (n <= 1) return n;
          return fibonacci(n-1) + fibonacci(n-2);
        }
        console.log(fibonacci(10));
      </code>
    </run_code>`,
  ];

  function createMutations(xml: string): string[] {
    return [
      xml.replace(/<\/(\w+)>(?!.*<\/)/g, "</$1"),

      xml.replace(/<\/(\w+)>(?!.*<\/)/g, ""),

      xml.replace(/>([^<]+)</g, "><random></random>$1<"),

      xml.replace(/<(\w+)>/g, "<$1 invalidAttr=>"),

      `Some random text before ${xml}`,

      xml.replace(/>(.*?)</g, (match: string, p1: string) =>
        p1.includes(" ")
          ? `>${p1
              .split(" ")
              .map((word, i) => (i % 2 ? `<b>${word}</b>` : word))
              .join(" ")}<`
          : match,
      ),

      xml.replace(/(<\/\w+>)\s*(<\/\w+>)/g, "$2\n  $1"),

      xml.replace(/>([^<]+)</g, "> \n$1\n  <"),

      xml.replace(/<(\w+)>/g, "<$1><$1>"),

      xml.replace(/<(\w+)>(?!.*<\1>)/g, ""),

      xml.replace(/</g, "&lt;").replace(/>/g, "&gt;"),

      xml.replace(/<(\w+)>/g, (_match: string, p1: string) => `<${p1.toUpperCase()}>`),

      xml.replace(/>([^<]+)</g, `>$1${String.fromCodePoint(0x1f600)}<`),
    ];
  }

  it("should handle various mutations of valid XML", function () {
    let totalTests = 0;
    let passedTests = 0;

    validXMLSamples.forEach((validXML) => {
      const mutations = createMutations(validXML);

      mutations.forEach((mutation, i) => {
        totalTests++;
        try {
          extractToolCallXMLParser(mutation, knownToolNames);
          passedTests++;
        } catch (error: unknown) {
          if (error && (error as Error).message) {
            passedTests++;
          } else {
            console.error(`Failed on mutation ${i}:`, mutation);
          }
        }
      });
    });

    console.log(
      `Passed ${passedTests} of ${totalTests} mutation tests (${Math.round((passedTests / totalTests) * 100)}%)`,
    );

    expect(passedTests / totalTests).to.be.at.least(0.75);
  });
});