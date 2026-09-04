import { describe, expect, it } from "vitest";
import { stripTrailingSlashes } from "./base-url.js";

/**
 * The contract of the one function that replaced 25 copies of `/\/+$/` (#908).
 *
 * The behaviour cases exist so the swap is provably identical to the regex it
 * replaced; the last case is the reason the swap happened at all.
 */
describe("stripTrailingSlashes", () => {
  it("strips one trailing slash", () => {
    expect(stripTrailingSlashes("https://x.test/")).toBe("https://x.test");
  });

  it("strips several", () => {
    expect(stripTrailingSlashes("https://x.test///")).toBe("https://x.test");
  });

  it("leaves a string with no trailing slash alone", () => {
    expect(stripTrailingSlashes("https://x.test")).toBe("https://x.test");
  });

  it("leaves INTERIOR slashes alone", () => {
    // The regex was anchored (`$`) and so is this. A helper that stripped every
    // slash would silently mangle every link the app sends.
    expect(stripTrailingSlashes("https://x.test/a/b/")).toBe("https://x.test/a/b");
  });

  it("handles the degenerate inputs the regex also handled", () => {
    expect(stripTrailingSlashes("")).toBe("");
    expect(stripTrailingSlashes("/")).toBe("");
    expect(stripTrailingSlashes("////")).toBe("");
  });

  it("passes `undefined` straight through, rather than returning an empty string", () => {
    // Six call sites were `process.env.APP_BASE_URL?.replace(…)`, where an unset var
    // yields `undefined` and the caller SKIPS building a link. Returning `""` there
    // would build `"/b/CODE"` — a relative link that goes nowhere — instead.
    expect(stripTrailingSlashes(undefined)).toBeUndefined();
  });

  it("is LINEAR — 100k trailing slashes complete in well under a second", () => {
    // The whole point (sonarjs/super-linear-regex). `/\/+$/` backtracks: the engine
    // retries `\/+` from successive start positions, which is quadratic in the run
    // length. This asserts the property the rule was flagging, not just the output.
    //
    // A generous ceiling on purpose — this must not go red on a slow CI runner. The
    // regex form is not merely over this bound, it does not finish in any useful time.
    const input = `https://x.test${"/".repeat(100_000)}`;
    const started = Date.now();
    expect(stripTrailingSlashes(input)).toBe("https://x.test");
    expect(Date.now() - started).toBeLessThan(500);
  });
});
