/**
 * The one way a reservation-trail event gets written (issue #1050, table from issue #1047).
 *
 * ## Why this exists rather than twenty calls to `repo.appendTrailEvent`
 *
 * Operator's ruling, 2026-09-20: *"I want the emits to be correct, but nobody shows up for
 * a boat they thought they booked because we do not emit correctly."* That orders the two
 * properties, and the ordering has to be **structural**. A rule that twenty emitter sites
 * must remember breaks on the one nobody checked; a helper they all go through cannot.
 *
 * Three properties, and only the first is obvious:
 *
 * **1. It never throws.** The `catch` is the whole point of the function. A trail write
 * that throws inside a booking path turns an audit failure into a customer who paid and has
 * no boat.
 *
 * **2. The swallow is logged.** Swallowing is right here; being silent about it is not —
 * that is #902's holding, and a silent hole in the record of what happened is precisely the
 * defect class this table exists to fix. `logSwallowed` carries the event id, because "a
 * trail write failed" without one names nothing anybody can go and recover.
 *
 * **3. It is the CALLER's job to call this after the commit, outside the lock.** This
 * function cannot enforce that and does not pretend to. A write that cannot throw can still
 * cost a customer their boat by holding the hull-day lock longer under contention — *not
 * throwing is not the same as not interfering.* Every call site below the booking path
 * therefore sits after its transaction, and that placement is what the emitter tests assert.
 *
 * ## The id is the caller's, and it must be deterministic
 *
 * `on conflict (id) do nothing` in the adapter is worth nothing against a random id: a
 * redelivered Stripe event would write a second row with a fresh uuid and the conflict
 * clause would never fire. So `id` is required here rather than generated, and the house
 * shape is `<type>:<stable key>` — the PaymentIntent id, the charge key, the dispute id.
 * Anything that is the same on a redelivery of the same fact.
 */

import { logSwallowed } from "../log.js";
import type { TrailEvent } from "../domain/reservation-trail.js";
import type { Repository } from "../ports/repository.js";

export interface TrailDeps {
  repo: Repository;
  now: () => string;
}

/** The event minus the clock — `timestamp` is stamped here so no call site can skew it. */
export type TrailDraft = Omit<TrailEvent, "timestamp">;

export async function recordTrail(deps: TrailDeps, draft: TrailDraft): Promise<void> {
  try {
    await deps.repo.appendTrailEvent({ ...draft, timestamp: deps.now() });
  } catch (e) {
    logSwallowed(
      "reservation-trail",
      e,
      `could not record ${draft.id} — the fact happened, the trail did not get it`,
    );
  }
}
