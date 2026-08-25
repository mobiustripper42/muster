import { describe, expect, it } from "vitest";
import { foldShiftChanges, type ShiftChangeRecord } from "./shift-changes.js";

/**
 * "What changed since you last looked" — the fold behind the crew banner (#769, DEC-158).
 *
 * **One banner describing everything since you last looked, not one per change** (DEC-158
 * Decision 4). That is the whole reason this is a fold rather than a list render: two changes
 * before the crew member opened the app are one story with one pair of endpoints, and it is also
 * the only shape that cannot drift out of sync with what the SMS said.
 *
 * **Re-raise falls out of the data, not a policy.** There is no "should we show it again" rule
 * anywhere — `changedAt > lastSeenAt` is the whole mechanism, so a second change brings the
 * banner back for free and a dismissal cannot accidentally be permanent.
 *
 * `tripsNow` is passed in rather than stored: the records carry *deltas* (`added`/`removed` event
 * ids), and the count the crew member is looking at is a property of the shift as it stands. The
 * before-count is reconstructed by walking the deltas back from it.
 */

const rec = (over: Partial<ShiftChangeRecord> = {}): ShiftChangeRecord => ({
  changedAt: "2026-07-04T18:00:00Z",
  added: [],
  removed: [],
  startBefore: null,
  startAfter: null,
  ...over,
});

describe("foldShiftChanges", () => {
  it("is null when nothing ever changed", () => {
    expect(foldShiftChanges([], { lastSeenAt: null, tripsNow: 3 })).toBeNull();
  });

  it("is null when every change predates the last look", () => {
    const records = [rec({ changedAt: "2026-07-04T18:00:00Z" })];
    expect(foldShiftChanges(records, { lastSeenAt: "2026-07-04T19:00:00Z", tripsNow: 3 })).toBeNull();
  });

  it("treats a change at exactly the last-seen instant as seen", () => {
    // DEC-158 says `changed_at > last_seen_at`, strictly. The boundary matters because the
    // dismiss write and the change can land in the same second on a fast tick, and the crew
    // member pressing "Got it" must not be shown the same banner again immediately.
    const records = [rec({ changedAt: "2026-07-04T18:00:00Z" })];
    expect(foldShiftChanges(records, { lastSeenAt: "2026-07-04T18:00:00Z", tripsNow: 3 })).toBeNull();
  });

  it("counts every change when the crew member has never looked", () => {
    const records = [
      rec({ changedAt: "2026-07-04T18:00:00Z" }),
      rec({ changedAt: "2026-07-04T19:00:00Z" }),
    ];
    const banner = foldShiftChanges(records, { lastSeenAt: null, tripsNow: 3 });
    expect(banner?.changeCount).toBe(2);
    expect(banner?.latestAt).toBe("2026-07-04T19:00:00Z");
  });

  it("counts only the changes since the last look", () => {
    const records = [
      rec({ changedAt: "2026-07-04T17:00:00Z" }),
      rec({ changedAt: "2026-07-04T19:00:00Z" }),
      rec({ changedAt: "2026-07-04T20:00:00Z" }),
    ];
    const banner = foldShiftChanges(records, { lastSeenAt: "2026-07-04T18:00:00Z", tripsNow: 3 });
    expect(banner?.changeCount).toBe(2);
  });

  it("spans the endpoints of the window, not of one change", () => {
    // Two moves before they looked: 3:30 → 2:45 → 2:00. The banner says 3:30 → 2:00, because
    // that is what changed from their point of view. Reporting the latest hop alone would
    // describe a move they never saw the start of.
    const records = [
      rec({
        changedAt: "2026-07-04T18:00:00Z",
        startBefore: "2026-07-04T19:30:00Z",
        startAfter: "2026-07-04T18:45:00Z",
      }),
      rec({
        changedAt: "2026-07-04T19:00:00Z",
        startBefore: "2026-07-04T18:45:00Z",
        startAfter: "2026-07-04T18:00:00Z",
      }),
    ];
    const banner = foldShiftChanges(records, { lastSeenAt: null, tripsNow: 3 });
    expect(banner?.startBefore).toBe("2026-07-04T19:30:00Z");
    expect(banner?.startAfter).toBe("2026-07-04T18:00:00Z");
  });

  it("is unsorted-input safe", () => {
    const records = [
      rec({ changedAt: "2026-07-04T19:00:00Z", startBefore: "2026-07-04T18:45:00Z", startAfter: "2026-07-04T18:00:00Z" }),
      rec({ changedAt: "2026-07-04T18:00:00Z", startBefore: "2026-07-04T19:30:00Z", startAfter: "2026-07-04T18:45:00Z" }),
    ];
    const banner = foldShiftChanges(records, { lastSeenAt: null, tripsNow: 3 });
    expect(banner?.startBefore).toBe("2026-07-04T19:30:00Z");
    expect(banner?.startAfter).toBe("2026-07-04T18:00:00Z");
  });

  it("says nothing about the start when the oldest one is unknown", () => {
    // A shift row written before the `earliest_start` watermark existed has no prior start.
    // Absent is UNKNOWN, not "changed" — the banner must not render a row it cannot
    // substantiate, exactly as `changeSummary` refuses to. Every pre-migration shift would
    // otherwise announce a retime that never happened.
    const records = [rec({ startBefore: null, startAfter: "2026-07-04T18:00:00Z" })];
    const banner = foldShiftChanges(records, { lastSeenAt: null, tripsNow: 3 });
    expect(banner).not.toBeNull();
    expect(banner?.startBefore).toBeNull();
    expect(banner?.startAfter).toBeNull();
  });

  it("says nothing about the start when it ends up where it began", () => {
    // Moved out and back before they looked. Nothing to tell them about the clock.
    const records = [
      rec({
        changedAt: "2026-07-04T18:00:00Z",
        startBefore: "2026-07-04T19:30:00Z",
        startAfter: "2026-07-04T18:00:00Z",
      }),
      rec({
        changedAt: "2026-07-04T19:00:00Z",
        startBefore: "2026-07-04T18:00:00Z",
        startAfter: "2026-07-04T19:30:00Z",
      }),
    ];
    const banner = foldShiftChanges(records, { lastSeenAt: null, tripsNow: 3 });
    expect(banner?.startBefore).toBeNull();
    expect(banner?.startAfter).toBeNull();
  });

  it("reconstructs the trip count before, by walking the deltas back from now", () => {
    // One trip added, and the shift now has 4 — so it had 3.
    const records = [rec({ added: ["evt-d"] })];
    const banner = foldShiftChanges(records, { lastSeenAt: null, tripsNow: 4 });
    expect(banner?.tripsBefore).toBe(3);
    expect(banner?.tripsAfter).toBe(4);
  });

  it("reconstructs across a removal", () => {
    const records = [rec({ removed: ["evt-a"] })];
    const banner = foldShiftChanges(records, { lastSeenAt: null, tripsNow: 2 });
    expect(banner?.tripsBefore).toBe(3);
  });

  it("nets a trip added and then removed to nothing", () => {
    // Added on the first change, removed on the second, both before they looked. The manifest
    // they are holding is the one they had; a banner claiming a trip count moved would be
    // describing an event that cancelled itself out.
    const records = [
      rec({ changedAt: "2026-07-04T18:00:00Z", added: ["evt-d"] }),
      rec({ changedAt: "2026-07-04T19:00:00Z", removed: ["evt-d"] }),
    ];
    const banner = foldShiftChanges(records, { lastSeenAt: null, tripsNow: 3 });
    expect(banner?.tripsBefore).toBeNull();
    expect(banner?.tripsAfter).toBeNull();
  });

  it("nets a one-for-one swap to no trip row, while still raising the banner", () => {
    // The gap `changeSummary` documents and cannot express: swap two trips and the count is
    // unchanged though the manifest really did move. The banner still appears — something
    // changed — it just has no honest trip row to show.
    const records = [rec({ added: ["evt-e"], removed: ["evt-a"] })];
    const banner = foldShiftChanges(records, { lastSeenAt: null, tripsNow: 3 });
    expect(banner).not.toBeNull();
    expect(banner?.changeCount).toBe(1);
    expect(banner?.tripsBefore).toBeNull();
    expect(banner?.tripsAfter).toBeNull();
  });
});
