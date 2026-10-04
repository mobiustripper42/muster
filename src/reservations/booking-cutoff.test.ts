/**
 * The booking cutoff's stored value (DEC-193, issue #1071). Whole hours in `app_settings`; absent
 * means 0, which means no cutoff. A bad value reads as 0 and is logged: the public site keeps
 * selling as it always has rather than refusing everything on a typo.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBookingCutoffHours } from "./booking-cutoff.js";

describe("parseBookingCutoffHours", () => {
  afterEach(() => vi.restoreAllMocks());

  it("absent ⇒ 0, silently — the fallback is not an error", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseBookingCutoffHours(null)).toBe(0);
    expect(parseBookingCutoffHours(undefined)).toBe(0);
    expect(err).not.toHaveBeenCalled();
  });

  it("reads a whole number of hours, 0 included", () => {
    expect(parseBookingCutoffHours("0")).toBe(0);
    expect(parseBookingCutoffHours("24")).toBe(24);
    expect(parseBookingCutoffHours(" 6 ")).toBe(6);
  });

  it.each(["-1", "1.5", "abc", "", "24h"])("%j reads as 0 and is logged", (raw) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseBookingCutoffHours(raw)).toBe(0);
    expect(err).toHaveBeenCalledOnce();
  });
});
