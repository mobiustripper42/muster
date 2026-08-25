import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { readShiftChangeBanner } from "./shift-changes.js";
import type { CrewMemberId, ShiftId } from "../domain/ids.js";

/**
 * The dismiss round trip (#769) — the half `foldShiftChanges` cannot answer on its own.
 *
 * The acceptance criteria that live here rather than in the fold's own tests are the two about
 * *people*: dismissal is per crew member, and a change arriving after a dismissal re-raises. Both
 * are properties of the stored pair of tables, so both need a repository to be true or false.
 *
 * Driven through `InMemoryRepository`, which is the test substrate the project keeps permanently
 * (`.claude/CLAUDE-context.md` — persistence sits behind the `Repository` port). The Postgres
 * adapter is exercised separately by `postgres-repository.test.ts`.
 */

const SHIFT = "shift-jul4-barrel" as ShiftId;
const QUINT = "crew-quint" as CrewMemberId;
const BRODY = "crew-brody" as CrewMemberId;

const change = (changedAt: string, over: Partial<{ added: string[]; removed: string[] }> = {}) => ({
  shiftId: SHIFT,
  crewMemberId: QUINT,
  changedAt,
  added: over.added ?? [],
  removed: over.removed ?? [],
  startBefore: "2026-07-04T19:30:00Z",
  startAfter: "2026-07-04T18:00:00Z",
});

describe("readShiftChangeBanner", () => {
  it("is null on a shift that never changed", async () => {
    const repo = new InMemoryRepository();
    expect(await readShiftChangeBanner(repo, SHIFT, QUINT, 3)).toBeNull();
  });

  it("raises after a change is recorded", async () => {
    const repo = new InMemoryRepository();
    await repo.recordShiftChanges([change("2026-07-04T18:00:00Z")]);
    const banner = await readShiftChangeBanner(repo, SHIFT, QUINT, 3);
    expect(banner?.changeCount).toBe(1);
  });

  it("clears after that crew member dismisses it", async () => {
    const repo = new InMemoryRepository();
    await repo.recordShiftChanges([change("2026-07-04T18:00:00Z")]);
    await repo.markShiftChangesSeen(SHIFT, QUINT, "2026-07-04T18:30:00Z");
    expect(await readShiftChangeBanner(repo, SHIFT, QUINT, 3)).toBeNull();
  });

  it("re-raises when a further change lands after the dismissal", async () => {
    // The mechanism is `changed_at > last_seen_at` and nothing else — no policy, no flag to
    // reset. This is the test that would fail if someone "optimised" dismissal by deleting the
    // change rows, which reads as equivalent and quietly makes a dismissal permanent.
    const repo = new InMemoryRepository();
    await repo.recordShiftChanges([change("2026-07-04T18:00:00Z")]);
    await repo.markShiftChangesSeen(SHIFT, QUINT, "2026-07-04T18:30:00Z");
    await repo.recordShiftChanges([change("2026-07-04T19:00:00Z")]);

    const banner = await readShiftChangeBanner(repo, SHIFT, QUINT, 3);
    expect(banner?.changeCount).toBe(1);
    expect(banner?.latestAt).toBe("2026-07-04T19:00:00Z");
  });

  it("does not clear the other crew member's banner", async () => {
    // Two crew on the same boat dismiss independently — "seen" is not a property of the shift
    // (DEC-158). A read marker keyed on shift alone would pass every test above and fail this
    // one, which is the whole reason it is here.
    const repo = new InMemoryRepository();
    await repo.recordShiftChanges([
      change("2026-07-04T18:00:00Z"),
      { ...change("2026-07-04T18:00:00Z"), crewMemberId: BRODY },
    ]);
    await repo.markShiftChangesSeen(SHIFT, QUINT, "2026-07-04T18:30:00Z");

    expect(await readShiftChangeBanner(repo, SHIFT, QUINT, 3)).toBeNull();
    expect((await readShiftChangeBanner(repo, SHIFT, BRODY, 3))?.changeCount).toBe(1);
  });

  it("keeps one crew member's changes out of another's count", async () => {
    const repo = new InMemoryRepository();
    await repo.recordShiftChanges([
      change("2026-07-04T18:00:00Z"),
      change("2026-07-04T19:00:00Z"),
      { ...change("2026-07-04T20:00:00Z"), crewMemberId: BRODY },
    ]);
    // Quint saw two changes; Brody saw one. Folding per shift would tell both of them "three".
    expect((await readShiftChangeBanner(repo, SHIFT, QUINT, 3))?.changeCount).toBe(2);
    expect((await readShiftChangeBanner(repo, SHIFT, BRODY, 3))?.changeCount).toBe(1);
  });
});

describe("adapter parity", () => {
  it("keeps the LATER dismissal when an older instant arrives second", async () => {
    // Both adapters must agree on this. Postgres upserts with `greatest()` so two dismisses
    // racing from two tabs cannot let the older instant win and re-raise a banner already
    // cleared; the in-memory store was a bare overwrite, which is last-CALL-wins rather than
    // last-INSTANT-wins. Nothing held the two to one behaviour, so dev/test disagreed with prod
    // on exactly that race and nothing said so (`@code-review`, this branch).
    const repo = new InMemoryRepository();
    await repo.recordShiftChanges([change("2026-07-04T18:00:00Z")]);
    await repo.markShiftChangesSeen(SHIFT, QUINT, "2026-07-04T19:00:00Z");
    await repo.markShiftChangesSeen(SHIFT, QUINT, "2026-07-04T18:30:00Z"); // older, arrives late
    expect(await repo.shiftChangeLastSeen(SHIFT, QUINT)).toBe("2026-07-04T19:00:00Z");
  });
});
