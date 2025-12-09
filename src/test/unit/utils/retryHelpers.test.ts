import { expect } from "chai";

import { fetchWithRetry, isRateLimitError, retryWithBackoff } from "../../utils/retryHelpers.js";

describe("retryHelpers", () => {
  describe("retryWithBackoff", () => {
    it("retries until the operation succeeds", async () => {
      let attempts = 0;
      const result = await retryWithBackoff(
        async () => {
          attempts += 1;
          if (attempts < 3) {
            throw new Error("temporary");
          }
          return "ok";
        },
        {
          maxRetries: 5,
          baseDelayMs: 0,
          maxDelayMs: 0,
          shouldRetry: () => true,
        }
      );

      expect(result).to.equal("ok");
      expect(attempts).to.equal(3);
    });

    it("short-circuits when shouldRetry returns false", async () => {
      let attempts = 0;
      try {
        await retryWithBackoff(
          async () => {
            attempts += 1;
            throw new Error("fatal");
          },
          {
            maxRetries: 5,
            baseDelayMs: 0,
            maxDelayMs: 0,
            shouldRetry: () => false,
          }
        );
        expect.fail("retryWithBackoff should have thrown");
      } catch (error) {
        expect((error as Error).message).to.equal("fatal");
      }

      expect(attempts).to.equal(1);
    });
  });

  describe("fetchWithRetry", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("retries 429 responses before succeeding", async () => {
      const fetchCalls: number[] = [];
      const responses = [
        new Response(null, { status: 429, headers: { "retry-after": "0" } }),
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
      ];

      globalThis.fetch = async () => {
        fetchCalls.push(responses.length);
        return responses.shift() ?? new Response(null, { status: 500 });
      };

      const response = await fetchWithRetry("http://example.test", {}, {
        maxRetries: 3,
        baseDelayMs: 0,
        maxDelayMs: 0,
      });

      expect(fetchCalls).to.have.length(2);
      expect(response.status).to.equal(200);
      const payload = await response.json() as { ok?: boolean };
      expect(payload.ok).to.be.true;
    });
  });

  describe("isRateLimitError", () => {
    it("detects 429 status and messages", () => {
      expect(isRateLimitError({ status: 429 })).to.be.true;
      expect(isRateLimitError(new Error("HTTP 429"))).to.be.true;
      expect(isRateLimitError("rate limit exceeded")).to.be.true;
      expect(isRateLimitError({ message: "Rate limit" })).to.be.true;
      expect(isRateLimitError(new Error("other"))).to.be.false;
    });
  });
});
