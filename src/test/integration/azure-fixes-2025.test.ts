/**
 * Legacy provider integration fixes (January 2025)
 *
 * Former compatibility cases retained only to document removal of the
 * additional provider-specific behaviours that used to live here.
 */

import { describe, it } from "mocha";

describe("Legacy provider compatibility tests", () => {
  it("are skipped because that provider support has been removed", function() {
    this.skip();
  });
});
