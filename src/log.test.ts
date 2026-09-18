import { describe, expect, it, vi, afterEach } from "vitest";
import { logSwallowed } from "./log.js";

/**
 * The core's half of the contract `app/lib/swallowed.test.ts` pins for the framework
 * layer (#902). Deliberately the same five cases against the same assertions, because
 * the two functions must not drift — the whole reason this task exists is that a
 * second way of doing one thing diverges without anyone noticing.
 *
 * They are separate functions rather than a shared one because `src/` is framework-free
 * (DEC-013/DEC-020) and cannot import from `app/`. That is a real constraint, and these
 * tests are what stops it becoming a licence for two different behaviours.
 */
describe("logSwallowed (core)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes to console.error, tagged with the surface", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSwallowed("reservations:confirm", new Error("boom"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]![0])).toContain("[reservations:confirm]");
  });

  it("passes the error as its OWN argument, not interpolated into the message", () => {
    // The whole point. `${e}` renders "Error: boom" and drops the stack, which is the
    // half naming the repository method and the table.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = new Error("boom");
    logSwallowed("reservations:confirm", e);
    expect(spy.mock.calls[0]![1]).toBe(e);
  });

  it("carries the consequence when the caller names one", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSwallowed("asks:relay", new Error("boom"), "a crew member was never asked");
    expect(String(spy.mock.calls[0]![0])).toContain("a crew member was never asked");
  });

  it("logs a non-Error throw rather than dropping it", () => {
    // `throw "string"` and `throw null` are legal, and several core call sites pass a
    // deliberately narrowed value — `e instanceof Error ? e.name : …` — where the full
    // error would carry a secret. A helper assuming `e.message` would log nothing for
    // exactly those.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSwallowed("auth:session", null);
    logSwallowed("auth:session", "SyntaxError");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]![1]).toBe(null);
    expect(spy.mock.calls[1]![1]).toBe("SyntaxError");
  });

  it("never throws, even if console.error itself does", () => {
    // It runs INSIDE a catch block. If it throws, the caller's degrade path never runs
    // and a recoverable failure becomes a crash — the helper causing a worse outage
    // than the one it reports.
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("logging is down");
    });
    expect(() => logSwallowed("reservations:confirm", new Error("boom"))).not.toThrow();
  });
});
