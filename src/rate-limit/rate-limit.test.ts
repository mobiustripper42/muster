/**
 * The general rate limiter (Phase 18.3a, issue #1117, DEC-189): a fixed-window counter, the
 * refusal log, what happens when the limiter itself breaks, and how a client address becomes a key.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { limitKeyFor, REFUSAL_KEEP_MS, takeRateLimit, type RateLimitPolicy } from "./rate-limit.js";

const POLICY: RateLimitPolicy = { bucket: "test", limit: 2, windowMs: 60_000, failOpen: true };
const IP = "203.0.113.9";

const clock = (iso: string) => () => iso;

describe("takeRateLimit", () => {
  it("allows up to the limit in a window and refuses the next, saying how long until the window ends", async () => {
    const repo = new InMemoryRepository();
    const deps = { repo, now: clock("2026-09-30T15:00:40.000Z") };
    expect(await takeRateLimit(deps, POLICY, IP)).toEqual({ allowed: true });
    expect(await takeRateLimit(deps, POLICY, IP)).toEqual({ allowed: true });
    expect(await takeRateLimit(deps, POLICY, IP)).toEqual({ allowed: false, retryAfterMs: 20_000 });
  });

  it("starts over in the next window", async () => {
    const repo = new InMemoryRepository();
    for (let i = 0; i < 3; i++) await takeRateLimit({ repo, now: clock("2026-09-30T15:00:40.000Z") }, POLICY, IP);
    expect(await takeRateLimit({ repo, now: clock("2026-09-30T15:01:00.000Z") }, POLICY, IP)).toEqual({ allowed: true });
  });

  it("counts each key on its own", async () => {
    const repo = new InMemoryRepository();
    const deps = { repo, now: clock("2026-09-30T15:00:40.000Z") };
    for (let i = 0; i < 3; i++) await takeRateLimit(deps, POLICY, IP);
    expect(await takeRateLimit(deps, POLICY, "198.51.100.4")).toEqual({ allowed: true });
  });

  it("aligns windows to the clock, so an hour window ends on the hour", async () => {
    const repo = new InMemoryRepository();
    const hourly: RateLimitPolicy = { bucket: "hourly", limit: 1, windowMs: 3_600_000, failOpen: true };
    const deps = { repo, now: clock("2026-09-30T15:20:00.000Z") };
    await takeRateLimit(deps, hourly, IP);
    expect(await takeRateLimit(deps, hourly, IP)).toEqual({ allowed: false, retryAfterMs: 40 * 60_000 });
  });

  it("with no key, it limits nothing and writes nothing — never one shared bucket for everyone", async () => {
    const repo = new InMemoryRepository();
    const deps = { repo, now: clock("2026-09-30T15:00:40.000Z") };
    for (let i = 0; i < 5; i++) expect(await takeRateLimit(deps, POLICY, null)).toEqual({ allowed: true });
    expect(await repo.incrementRateLimit(POLICY.bucket, "", "2026-09-30T15:00:00.000Z", "2026-09-30T15:01:00.000Z", "2026-09-30T15:00:40.000Z")).toBe(1);
  });

  it("logs each refused window once, raising its counts and keeping when it was first refused", async () => {
    const repo = new InMemoryRepository();
    const at = (s: string) => ({ repo, now: clock(`2026-09-30T15:00:${s}.000Z`) });
    await takeRateLimit(at("10"), POLICY, IP);
    await takeRateLimit(at("11"), POLICY, IP);
    expect(await repo.listRateLimitRefusals()).toEqual([]);

    await takeRateLimit(at("12"), POLICY, IP);
    await takeRateLimit(at("13"), POLICY, IP);
    expect(await repo.listRateLimitRefusals()).toEqual([
      {
        bucket: "test",
        key: IP,
        windowStart: "2026-09-30T15:00:00.000Z",
        hits: 4,
        refused: 2,
        firstRefusedAt: "2026-09-30T15:00:12.000Z",
        lastRefusedAt: "2026-09-30T15:00:13.000Z",
        // Kept 90 days from the LATEST refusal in the window.
        expiresAt: new Date(Date.parse("2026-09-30T15:00:13.000Z") + REFUSAL_KEEP_MS).toISOString(),
      },
    ]);
  });

  describe("when the limiter itself breaks", () => {
    class CounterDown extends InMemoryRepository {
      override async incrementRateLimit(): Promise<number> {
        throw new Error("relation rate_limit_hits does not exist");
      }
    }
    class LogDown extends InMemoryRepository {
      override async recordRateLimitRefusal(): Promise<void> {
        throw new Error("disk full");
      }
    }

    it("a fail-open policy lets the request through and reports the failure", async () => {
      const failures: string[] = [];
      const deps = { repo: new CounterDown(), now: clock("2026-09-30T15:00:40.000Z"), onFailure: (m: string) => failures.push(m) };
      expect(await takeRateLimit(deps, POLICY, IP)).toEqual({ allowed: true });
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatch(/test/);
    });

    it("a fail-closed policy refuses for one window", async () => {
      const deps = { repo: new CounterDown(), now: clock("2026-09-30T15:00:40.000Z") };
      expect(await takeRateLimit(deps, { ...POLICY, failOpen: false }, IP)).toEqual({ allowed: false, retryAfterMs: 60_000 });
    });

    it("a broken refusal log never turns a refusal into an allow", async () => {
      const failures: string[] = [];
      const deps = { repo: new LogDown(), now: clock("2026-09-30T15:00:40.000Z"), onFailure: (m: string) => failures.push(m) };
      await takeRateLimit(deps, POLICY, IP);
      await takeRateLimit(deps, POLICY, IP);
      expect(await takeRateLimit(deps, POLICY, IP)).toEqual({ allowed: false, retryAfterMs: 20_000 });
      expect(failures).toHaveLength(1);
    });
  });
});

describe("limitKeyFor", () => {
  it("keeps an IPv4 address as it is, trimmed", () => {
    expect(limitKeyFor(" 203.0.113.9 ")).toBe("203.0.113.9");
  });

  it("unwraps an IPv4 address written in IPv6 form", () => {
    // eslint-disable-next-line sonarjs/no-hardcoded-ip -- test fixture: a documentation address (RFC 5737) in IPv6-mapped form
    expect(limitKeyFor("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("keys IPv6 on its /64 — one home or phone network holds a whole /64", () => {
    expect(limitKeyFor("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd:12::/64");
    // eslint-disable-next-line sonarjs/no-hardcoded-ip -- test fixture: a documentation address (RFC 3849), uppercase with leading zeros
    expect(limitKeyFor("2001:DB8:ABCD:0012:ffff::1")).toBe("2001:db8:abcd:12::/64");
    expect(limitKeyFor("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });

  it.each([null, undefined, "", "not-an-ip", "999.1.1.1", "203.0.113", "2001:db8::1::2"])(
    "has no key for something that is not an address (%j)",
    (raw) => {
      expect(limitKeyFor(raw)).toBeNull();
    },
  );
});
