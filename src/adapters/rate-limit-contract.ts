/**
 * Rate limiting — the Repository contract for Phase 18.3a (issue #1117, DEC-189).
 *
 * Registered by both adapters' test files, like `check-in-contract.ts`. The Postgres-only
 * concurrency case (N parallel increments return 1…N) lives in `postgres-repository.test.ts`,
 * because the in-memory double is single-threaded and would pass it by construction.
 *
 * Not a test file itself (no `.test`): it exports a function that registers the describe/it blocks.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Repository } from "../ports/repository.js";
import type { RateLimitRefusal } from "../rate-limit/entities.js";

const W1 = "2026-09-30T15:00:00.000Z";
const W1_END = "2026-09-30T15:01:00.000Z";
const W2 = "2026-09-30T15:01:00.000Z";
const W2_END = "2026-09-30T15:02:00.000Z";

const refusal = (over: Partial<RateLimitRefusal> = {}): RateLimitRefusal => ({
  bucket: "crew-sign-in",
  key: "203.0.113.9",
  windowStart: W1,
  hits: 21,
  refused: 1,
  firstRefusedAt: "2026-09-30T15:00:40.000Z",
  lastRefusedAt: "2026-09-30T15:00:40.000Z",
  expiresAt: "2026-12-29T15:00:40.000Z",
  ...over,
});

export function runRateLimitContract(label: string, makeFreshRepo: () => Promise<Repository>): void {
  describe(`Rate limit contract — ${label}`, () => {
    let repo: Repository;
    beforeEach(async () => {
      repo = await makeFreshRepo();
    });

    describe("the counter", () => {
      it("counts hits per bucket, key and window, returning the count after each", async () => {
        const now = "2026-09-30T15:00:10.000Z";
        expect(await repo.incrementRateLimit("crew-sign-in", "203.0.113.9", W1, W1_END, now)).toBe(1);
        expect(await repo.incrementRateLimit("crew-sign-in", "203.0.113.9", W1, W1_END, now)).toBe(2);
        // Another key, another bucket and another window each start from one.
        expect(await repo.incrementRateLimit("crew-sign-in", "198.51.100.4", W1, W1_END, now)).toBe(1);
        expect(await repo.incrementRateLimit("trip-link", "203.0.113.9", W1, W1_END, now)).toBe(1);
        expect(await repo.incrementRateLimit("crew-sign-in", "203.0.113.9", W2, W2_END, "2026-09-30T15:01:05.000Z")).toBe(1);
      });

      it("sweeps a window once it has ended, so a returning key starts over", async () => {
        await repo.incrementRateLimit("crew-sign-in", "203.0.113.9", W1, W1_END, "2026-09-30T15:00:10.000Z");
        await repo.incrementRateLimit("crew-sign-in", "203.0.113.9", W1, W1_END, "2026-09-30T15:00:20.000Z");
        // Called with W1's own window after it ended: the stale row is gone, so this is hit one.
        expect(await repo.incrementRateLimit("crew-sign-in", "203.0.113.9", W1, W1_END, W1_END)).toBe(1);
      });
    });

    describe("the refusal log", () => {
      it("records a refused window and reads it back", async () => {
        await repo.recordRateLimitRefusal(refusal(), "2026-09-30T15:00:40.000Z");
        expect(await repo.listRateLimitRefusals()).toEqual([refusal()]);
      });

      it("keeps one row per window: later refusals raise the counts and move the last time, never the first", async () => {
        await repo.recordRateLimitRefusal(refusal(), "2026-09-30T15:00:40.000Z");
        await repo.recordRateLimitRefusal(
          refusal({ hits: 25, refused: 5, firstRefusedAt: "2026-09-30T15:00:55.000Z", lastRefusedAt: "2026-09-30T15:00:55.000Z" }),
          "2026-09-30T15:00:55.000Z",
        );
        // An out-of-order write (a slower request finishing late) never lowers anything.
        await repo.recordRateLimitRefusal(
          refusal({ hits: 23, refused: 3, firstRefusedAt: "2026-09-30T15:00:50.000Z", lastRefusedAt: "2026-09-30T15:00:50.000Z" }),
          "2026-09-30T15:00:56.000Z",
        );
        expect(await repo.listRateLimitRefusals()).toEqual([
          refusal({ hits: 25, refused: 5, lastRefusedAt: "2026-09-30T15:00:55.000Z", expiresAt: "2026-12-29T15:00:40.000Z" }),
        ]);
      });

      it("sweeps rows past their keep-until on the next write", async () => {
        await repo.recordRateLimitRefusal(refusal({ expiresAt: "2026-10-01T00:00:00.000Z" }), "2026-09-30T15:00:40.000Z");
        const later = refusal({ key: "198.51.100.4", windowStart: W2 });
        await repo.recordRateLimitRefusal(later, "2026-10-02T00:00:00.000Z");
        expect(await repo.listRateLimitRefusals()).toEqual([later]);
      });
    });
  });
}
