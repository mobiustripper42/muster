import { describe, expect, it, vi, afterEach } from "vitest";
import { logSwallowed } from "./swallowed";

/**
 * The contract of the one function that stands between a caught error and
 * nothing at all (#854). Four of these five cases are about *not* losing
 * information; the fifth is about not causing the damage it exists to report.
 */
describe("logSwallowed", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes to console.error, tagged with the surface", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSwallowed("crew/shift", new Error("boom"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]![0])).toContain("[crew/shift]");
  });

  it("passes the error as its OWN argument, not interpolated into the message", () => {
    // The whole point. `${e}` renders "Error: boom" and drops the stack, which is
    // the half that says WHERE — the founding bug was diagnosed only from a stack
    // naming postgres-repository.ts. A second console.error argument is what
    // Vercel's log inspector expands.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = new Error("boom");
    logSwallowed("crew/shift", e);
    expect(spy.mock.calls[0]![1]).toBe(e);
  });

  it("carries the consequence when the caller names one", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSwallowed("admin/shift:audit", new Error("boom"), "the audit row was not written");
    expect(String(spy.mock.calls[0]![0])).toContain("the audit row was not written");
  });

  it("logs a non-Error throw rather than dropping it", () => {
    // `throw "string"` and `throw null` are legal, and a helper that assumes
    // `e.message` would log nothing useful for exactly the weird failure you
    // most want the record of.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSwallowed("crew", null);
    logSwallowed("crew", "just a string");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]![1]).toBe(null);
    expect(spy.mock.calls[1]![1]).toBe("just a string");
  });

  it("never throws, even if console.error itself does", () => {
    // It runs INSIDE a catch block. If it throws, the caller's failure state
    // never renders and a degraded page becomes a 500 — this helper would then
    // cause a worse outage than the one it reports.
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("logging is down");
    });
    expect(() => logSwallowed("crew", new Error("boom"))).not.toThrow();
  });
});
