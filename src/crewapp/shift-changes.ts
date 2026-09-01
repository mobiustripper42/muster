/**
 * What changed on this shift since a crew member last looked (#769, DEC-158 Decision 4).
 *
 * The SMS half of #740 shipped first and is a **strict subset** by design — it carries the
 * shortest true tokens that fit one GSM-7 segment and drops the rest. That is only safe if the
 * app carries all of it, which is what this fold is for. Until it existed the SMS was making a
 * promise the app did not keep: the fallback text pointed at a surface that showed the shift but
 * not what changed about it.
 *
 * ## One banner, not one per change
 *
 * Two changes before the crew member opened the app are one story with one pair of endpoints —
 * `3:30 → 2:45 → 2:00` is reported as `3:30 → 2:00`, because that is what changed from their
 * point of view. Reporting the newest hop alone would describe a move they never saw the start
 * of. It is also the only shape that cannot drift out of sync with what the SMS told them.
 *
 * ## Re-raise is data, not policy
 *
 * There is no "should we show this again" rule anywhere in this file. `changedAt > lastSeenAt`
 * is the entire mechanism, so a change arriving after a dismissal brings the banner back for
 * free, and a dismissal cannot accidentally become permanent.
 *
 * ## Nothing is claimed that the record cannot substantiate
 *
 * Both the start pair and the trip pair come back `null` when there is nothing honest to say —
 * unknown, or unmoved. That mirrors `src/adapters/change-summary.ts`, which refuses to name a
 * clock change it cannot support, and it exists because a shift row written before the
 * `earliest_start` watermark has no prior start: treating absent as "changed" would have every
 * pre-migration shift announce a retime that never happened.
 */

import type { Repository } from "../ports/repository.js";
import type { CrewMemberId, ShiftId } from "../domain/ids.js";

/** One recorded change to one shift, for one crew member. Mirrors the `shift_changes` row. */
export interface ShiftChangeRecord {
  /** ISO-8601 UTC instant the change was observed. */
  changedAt: string;
  /** Event ids gained and lost in this one change. */
  added: string[];
  removed: string[];
  /**
   * Earliest scheduled departure before/after, ISO instants. `null` = unknown or none — the
   * same meaning the absent column has. The crew-facing SHIFT START is this minus
   * `CALL_LEAD_MINUTES`, derived at the surface rather than stored twice (DEC-157).
   */
  startBefore: string | null;
  startAfter: string | null;
}

/**
 * Everything the banner needs. `null` fields mean "nothing honest to show", not zero.
 *
 * **There is deliberately no count of changes (#766).** There was one, and it rendered as "This
 * shift changed twice" — a row count, so two overlapping `formShifts` runs recording one change
 * twice made the app say it happened twice. Rather than teach the reader to tell a duplicate row
 * from a real repeat, the count went: a crew member needs to know their day moved and what it is
 * now, which the pairs below carry. Removing it deleted the defect rather than guarding it.
 */
export interface ChangeBanner {
  /** ISO instant of the most recent change — the banner's "Changed …" stamp. */
  latestAt: string;
  /** Earliest departure at the start and end of the window, or `null` when unknown/unmoved. */
  startBefore: string | null;
  startAfter: string | null;
  /** Trip count at the start and end of the window, or `null` when unmoved. */
  tripsBefore: number | null;
  tripsAfter: number | null;
}

/**
 * Fold every unseen change into one banner. `null` when there is nothing to raise.
 *
 * `tripsNow` is the shift's current trip count and is passed in rather than stored, because the
 * records carry *deltas* while the number the crew member is looking at is a property of the
 * shift as it stands. The before-count is reconstructed by walking those deltas back from it.
 */
export function foldShiftChanges(
  records: ShiftChangeRecord[],
  opts: { lastSeenAt: string | null; tripsNow: number },
): ChangeBanner | null {
  // Strictly after, per DEC-158. The boundary is load-bearing rather than pedantic: a dismiss
  // write and a change can land in the same instant on a fast tick, and a crew member who just
  // pressed "Got it" must not be handed the same banner back.
  const unseen = records
    .filter((r) => opts.lastSeenAt === null || r.changedAt > opts.lastSeenAt)
    // Sorted here rather than trusted from the caller — two callers read these rows and only one
    // of them has a reason to order them.
    .sort((a, b) => (a.changedAt < b.changedAt ? -1 : a.changedAt > b.changedAt ? 1 : 0));

  if (unseen.length === 0) return null;

  const oldest = unseen[0]!;
  const newest = unseen[unseen.length - 1]!;

  // Both ends must be known AND different. Either condition failing means there is no clock
  // change this record can support, which is not the same as there being no change at all —
  // the banner still raises, it just has no start row.
  const startKnown =
    oldest.startBefore !== null &&
    newest.startAfter !== null &&
    oldest.startBefore !== newest.startAfter;

  // Per id: was it on the shift when the window opened, and is it on now?
  //
  // **First and last touch, not two flattened unions.** Netting `∪added` against `∪removed` is
  // the obvious version and it is wrong on any id touched an odd number of times above one: a
  // `Set` collapses touches to membership, so `remove d, add d, remove d` puts `d` in both
  // unions, cancels, and reports the count as unmoved when the shift really did lose a trip.
  // That is not contrived — every Xola pull, split and merge writes its own `changedCrew` row
  // (`form-shifts.ts:483-505`), so several touches before a crew member opens the app is
  // ordinary. Found by `@code-review` on this branch.
  //
  // The window is already sorted, so the FIRST touch of an id tells us its state before (first
  // seen being `removed` means it must have been present) and the LAST tells us its state now.
  const firstTouch = new Map<string, "added" | "removed">();
  const lastTouch = new Map<string, "added" | "removed">();
  for (const r of unseen) {
    for (const [kind, ids] of [["added", r.added], ["removed", r.removed]] as const) {
      for (const id of ids) {
        if (!firstTouch.has(id)) firstTouch.set(id, kind);
        lastTouch.set(id, kind);
      }
    }
  }
  let appeared = 0;
  let vanished = 0;
  for (const id of firstTouch.keys()) {
    const wasPresent = firstTouch.get(id) === "removed";
    const isPresent = lastTouch.get(id) === "added";
    if (isPresent && !wasPresent) appeared++;
    if (wasPresent && !isPresent) vanished++;
  }
  const tripsBefore = opts.tripsNow - appeared + vanished;
  // Unmoved reads as nothing to say. This is also the one-for-one swap `changeSummary`
  // documents and cannot express: the count is unchanged though the manifest really did move,
  // so the banner appears with no trip row rather than claiming a number that did not change.
  const tripsMoved = tripsBefore !== opts.tripsNow;

  return {
    latestAt: newest.changedAt,
    startBefore: startKnown ? oldest.startBefore : null,
    startAfter: startKnown ? newest.startAfter : null,
    tripsBefore: tripsMoved ? tripsBefore : null,
    tripsAfter: tripsMoved ? opts.tripsNow : null,
  };
}

/**
 * The banner for one crew member's view of one shift, or `null` when there is nothing to raise.
 *
 * Two reads and a pure fold. They are separated because the fold is where every rule about what
 * may be *claimed* lives, and that has to be testable without a database — but "dismissal is per
 * crew member" and "a later change re-raises" are properties of the stored pair of tables, so
 * they need this function to be true or false. Both halves have their own tests for that reason.
 *
 * **Nothing here deletes a change row on dismissal.** Marking seen is the whole of it. Clearing
 * the rows would read as equivalent and would quietly make a dismissal permanent, because a
 * later change still has to be able to describe the window it belongs to.
 */
export async function readShiftChangeBanner(
  repo: Repository,
  shiftId: ShiftId,
  crewMemberId: CrewMemberId,
  tripsNow: number,
): Promise<ChangeBanner | null> {
  const [records, lastSeenAt] = await Promise.all([
    repo.listShiftChanges(shiftId, crewMemberId),
    repo.shiftChangeLastSeen(shiftId, crewMemberId),
  ]);
  return foldShiftChanges(records, { lastSeenAt, tripsNow });
}

/**
 * Is there anything unseen on this shift for this crew member? (#769)
 *
 * The My-shifts list wants a flag, not a story — see `MyShiftView.changed`. Routed through the
 * same fold rather than a bare row count so the two surfaces cannot disagree: a change that the
 * card would decline to describe must not still light a pill in the list, and a count-only check
 * would do exactly that on a window whose changes all net out.
 */
export async function hasUnseenShiftChanges(
  repo: Repository,
  shiftId: ShiftId,
  crewMemberId: CrewMemberId,
): Promise<boolean> {
  // `tripsNow` is irrelevant to whether anything is unseen — the fold raises on the window being
  // non-empty, and the trip pair only decides whether a ROW renders. Zero keeps this from
  // needing a manifest read per row in the list.
  return (await readShiftChangeBanner(repo, shiftId, crewMemberId, 0)) !== null;
}
