import { describe, expect, it, vi, afterEach } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import { recordTrail } from "./trail.js";

/**
 * The write path's safety properties (issue #1050, ruled by the operator 2026-09-20:
 * *"nobody shows up for a boat they thought they booked because we do not emit
 * correctly"*).
 *
 * Every one of these is a property of THIS helper rather than of the twenty call sites
 * that use it. A rule twenty sites must honour breaks on the one nobody checked; this is
 * the mechanism version, and these are the tests that say it still holds.
 */

const REPO = () => new InMemoryRepository();
const NOW = () => "2026-09-20T12:00:00.000Z";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordTrail", () => {
  it("writes the row it is given", async () => {
    const repo = REPO();
    await recordTrail(
      { repo, now: NOW },
      {
        id: asId<"TrailEventId">("auto_refunded:pi_1"),
        actorKind: "engine",
        type: "auto_refunded",
        metadata: {},
      },
    );
    const [row] = await repo.listTrailEvents();
    expect(row?.id).toBe("auto_refunded:pi_1");
    expect(row?.timestamp).toBe("2026-09-20T12:00:00.000Z");
  });

  it("NEVER throws into the caller, even when the repository does", async () => {
    // The property that matters most. A trail write that throws inside a booking path
    // turns an audit failure into a customer who has paid and has no boat.
    const repo = REPO();
    vi.spyOn(repo, "appendTrailEvent").mockRejectedValue(new Error("pg is down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      recordTrail(
        { repo, now: NOW },
        {
          id: asId<"TrailEventId">("auto_refunded:pi_2"),
          actorKind: "engine",
          type: "auto_refunded",
          metadata: {},
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("logs the swallow — silence is the defect the trail exists to fix", async () => {
    // Swallowing is right; being silent about it is not (#902). A missing trail row must
    // leave a trace somewhere, or the audit log has a hole that nothing can find.
    const repo = REPO();
    const boom = new Error("pg is down");
    vi.spyOn(repo, "appendTrailEvent").mockRejectedValue(boom);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await recordTrail(
      { repo, now: NOW },
      {
        id: asId<"TrailEventId">("dispute_lost:pi_3"),
        actorKind: "stripe",
        type: "dispute_lost",
        metadata: {},
      },
    );

    expect(spy).toHaveBeenCalledOnce();
    const [message, err] = spy.mock.calls[0]!;
    // The type and the id both, because "a trail write failed" with no id names nothing
    // recoverable — the whole point is being able to say which fact went missing.
    expect(String(message)).toContain("dispute_lost:pi_3");
    // The error object itself, never interpolated: `${e}` drops the stack.
    expect(err).toBe(boom);
  });

  it("is idempotent when the id is deterministic — a redelivery does not duplicate", async () => {
    // `on conflict (id) do nothing` only helps if the id is derived from the FACT. A
    // random id would write a second row on every Stripe redelivery and the conflict
    // clause would never fire, which is why `id` is required rather than generated here.
    const repo = REPO();
    const deps = { repo, now: NOW };
    const event = {
      id: asId<"TrailEventId">("dispute_won:pi_4"),
      actorKind: "stripe" as const,
      type: "dispute_won" as const,
      metadata: {},
    };
    await recordTrail(deps, event);
    await recordTrail(deps, event);
    expect(await repo.listTrailEvents()).toHaveLength(1);
  });
});
