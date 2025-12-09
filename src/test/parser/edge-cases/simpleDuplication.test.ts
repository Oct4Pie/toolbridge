import { expect } from "chai";
import { beforeEach, describe, it } from "mocha";

interface MockResponse {
  write: (chunk: string) => void;
}

describe("Simple Duplication Test", function () {
  let capturedChunks: string[];

  beforeEach(function () {
    capturedChunks = [];
  });

  it("should properly capture chunks", function () {
    const mockResponse: MockResponse = {
      write: (chunk: string) => {
        capturedChunks.push(chunk);
      },
    };

    expect(capturedChunks.length).to.equal(0);
    mockResponse.write("test chunk");
    expect(capturedChunks.length).to.equal(1);
    expect(capturedChunks[0]).to.equal("test chunk");
  });
});