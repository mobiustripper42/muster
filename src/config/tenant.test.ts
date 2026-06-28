import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOORBELL_BATCH_WINDOW_MS,
  DOORBELL_PRESENCE_WINDOW_MS,
} from "./tenant.js";

describe("doorbell window defaults (DEC-060)", () => {
  it("ship the ratified defaults — 90 s batch, 5 min presence", () => {
    expect(DOORBELL_BATCH_WINDOW_MS).toBe(90_000);
    expect(DOORBELL_PRESENCE_WINDOW_MS).toBe(300_000);
  });

  it("presence window exceeds the batch window (DEC-060 invariant)", () => {
    // A focused reader emits no activity during the batch hold; the staleness
    // window must outlast it or we'd text someone staring at the message.
    expect(DOORBELL_PRESENCE_WINDOW_MS).toBeGreaterThan(DOORBELL_BATCH_WINDOW_MS);
  });

  it("both windows are positive, finite ms", () => {
    for (const ms of [DOORBELL_BATCH_WINDOW_MS, DOORBELL_PRESENCE_WINDOW_MS]) {
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThan(0);
    }
  });
});

describe("doorbell windows are env-tunable, not hardcoded (DEC-060 AC)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("a valid env override replaces the default", async () => {
    vi.stubEnv("DOORBELL_BATCH_WINDOW_MS", "45000");
    vi.resetModules();
    const m = await import("./tenant.js");
    expect(m.DOORBELL_BATCH_WINDOW_MS).toBe(45_000);
  });

  it("a non-numeric override falls back to the researched default", async () => {
    vi.stubEnv("DOORBELL_PRESENCE_WINDOW_MS", "not-a-number");
    vi.resetModules();
    const m = await import("./tenant.js");
    expect(m.DOORBELL_PRESENCE_WINDOW_MS).toBe(300_000);
  });

  it("a non-positive override falls back too", async () => {
    vi.stubEnv("DOORBELL_BATCH_WINDOW_MS", "0");
    vi.resetModules();
    const m = await import("./tenant.js");
    expect(m.DOORBELL_BATCH_WINDOW_MS).toBe(90_000);
  });
});
