import { expect } from "chai";
import { needsToolReinjection, estimateTokenCount } from "../../../utils/promptUtils.js";
import type { OpenAIMessage } from "../../../types/index.js";

describe("Tool reinjection thresholds", () => {
  it("should request reinjection when no recent system message", () => {
    const messages: OpenAIMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "use tool" },
    ];
    const need = needsToolReinjection(messages, 1000, 3);
    expect(need).to.equal(true);
  });

  it("should request reinjection by message count threshold", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" },
      { role: "user", content: "e" },
    ];
    const need = needsToolReinjection(messages, 1e9, 3);
    expect(need).to.equal(true); // last 5 after system exceed messageCount=3
  });

  it("should request reinjection by token count threshold", () => {
    const big = "x".repeat(2000); // ~500 tokens
    const messages: OpenAIMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: big },
      { role: "assistant", content: big },
      { role: "user", content: big },
    ];
    const tokens = messages.slice(1).reduce((s,m)=>s+estimateTokenCount(m),0);
    expect(tokens).to.be.greaterThan(1000);
    const need = needsToolReinjection(messages, 1000, 9999);
    expect(need).to.equal(true);
  });

  it("should not request reinjection when recent system exists and below thresholds", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "short" },
      { role: "assistant", content: "short" },
    ];
    const need = needsToolReinjection(messages, 1000, 3);
    expect(need).to.equal(false);
  });
});
