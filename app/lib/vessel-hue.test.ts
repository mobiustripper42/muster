/**
 * vesselHueClass (12.9) — a stored hue wins; absent, the legacy derivation stands.
 */
import { describe, expect, it } from "vitest";
import { HUE_COUNT, vesselHueClass } from "./vessel-hue";

describe("vesselHueClass", () => {
  it("uses the operator-chosen stored hue when it's a valid 1-based index", () => {
    expect(vesselHueClass("anything", 1)).toBe("bg-vessel-1");
    expect(vesselHueClass("anything", HUE_COUNT)).toBe(`bg-vessel-${HUE_COUNT}`);
    // Stored hue overrides even a pinned id.
    expect(vesselHueClass("vessel-brew-1", 5)).toBe("bg-vessel-5");
  });

  it("falls back to the legacy derivation when the hue is absent or out of range", () => {
    // Pinned real-fleet id keeps its chosen hue.
    expect(vesselHueClass("vessel-brew-1")).toBe("bg-vessel-1");
    expect(vesselHueClass("vessel-brew-1", null)).toBe("bg-vessel-1");
    expect(vesselHueClass("vessel-brew-1", 0)).toBe("bg-vessel-1"); // out of range → fallback
    expect(vesselHueClass("vessel-brew-1", 99)).toBe("bg-vessel-1");
  });

  it("is stable for an unpinned id via the hash fallback", () => {
    const a = vesselHueClass("vessel-brewboat");
    const b = vesselHueClass("vessel-brewboat");
    expect(a).toBe(b);
    expect(a).toMatch(/^bg-vessel-[1-6]$/);
  });
});
