import { describe, expect, it } from "vitest";
import { isPresent } from "./presence.js";

const NOW = "2026-07-01T12:10:00.000Z";
const WINDOW = 5 * 60 * 1000; // 5 minutes

describe("isPresent (doorbell presence classifier)", () => {
  it("active within the window → present", () => {
    expect(isPresent("2026-07-01T12:06:00.000Z", NOW, WINDOW)).toBe(true); // 4m ago
  });

  it("active longer ago than the window → not present", () => {
    expect(isPresent("2026-07-01T12:04:00.000Z", NOW, WINDOW)).toBe(false); // 6m ago
  });

  it("exactly at the window boundary → not present (strict <)", () => {
    expect(isPresent("2026-07-01T12:05:00.000Z", NOW, WINDOW)).toBe(false); // exactly 5m
  });

  it("never seen (null/undefined) → not present — fail toward ringing", () => {
    expect(isPresent(null, NOW, WINDOW)).toBe(false);
    expect(isPresent(undefined, NOW, WINDOW)).toBe(false);
  });

  it("last-active in the future (clock skew) → present", () => {
    expect(isPresent("2026-07-01T12:11:00.000Z", NOW, WINDOW)).toBe(true);
  });
});
