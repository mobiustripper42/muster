"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  bailWithDerivedLateness,
  confirmSeat,
  overrideSeat,
  vacateSeat,
} from "@core/asks/ask-loop.js";
import { assignFromPool, lean } from "@core/asks/lean.js";
import {
  addOverrideSeat,
  removeOverrideSeat,
  staffTraineeSeat,
  unstaffTraineeSeat,
} from "@core/builder/manning.js";
import { asId } from "@core/domain/ids.js";
import { logCrewAdded, logCrewRemoved } from "@core/oracle/audit-log.js";
import { readSubject } from "../../../../lib/auth";
import { cockpitHref } from "../../../../lib/cockpit-href";
import { forwardToOutbox, forwardNoticesToOutbox } from "../../../../lib/channel";
import { getRepo } from "../../../../lib/repo";
import { OPERATOR_CREW_MEMBER_ID } from "../../../../lib/operator";
import { TENANT_ID } from "../../../../lib/tenant";

/**
 * Cockpit seat actions (SPEC §2.4, #54, DEC-027 §1) — auth + glue over the
 * domain rails; the rules live in `@core`. Four actions, one shape: feedback
 * rides redirect search params as CODES/ids only, never prose (DEC-026 — the
 * page maps codes to copy, so a crafted URL can't put text in Spink's UI).
 * `redirect()` throws by design and stays OUTSIDE the try; only the domain call
 * is guarded (a repo outage becomes a mapped notice, not a 500).
 *
 * - assign  → `assignFromPool` (guarded — lean's accept set, per seat; a
 *             crafted form post cannot reach unlabeled override semantics)
 * - nudge   → `lean` (manual Tier-2; the shift-level seat pick is the domain's)
 * - confirm → `confirmSeat` (Claimed → Confirmed)
 * - override→ `overrideSeat` (the authority backstop — bypasses pool/rank/state,
 *             but honors the role-competency floor: no mate as captain, DEC-064)
 * - report a bail → `bail()` (#56 admin half, DEC-028) — Spink files the bail
 *             he heard about
 * - remove      → `vacateSeat` (#87) — clears a *misassignment* with NO penalty;
 *             the no-bail recovery for a wrong-person placement (Bailed carries
 *             the reliability cost; this doesn't)
 */

/**
 * The host context (DEC-085 pane mechanics): a hidden `ctx` input marks a
 * board-pane render and carries the board's filter QUERY STRING ("" is the
 * default window). Never a form-supplied path — `cockpitHref` interpolates it
 * after the `?` of a hard-coded path, the split/merge `back` posture (DEC-026).
 * Absent (`null`) → the standalone cockpit route.
 */
function hostCtx(formData: FormData): string | null {
  const v = formData.get("ctx");
  return typeof v === "string" ? v : null;
}

/** Auth + the form's ids, or redirect out. Shared head of every action. */
async function gate(formData: FormData): Promise<{
  shiftId: string;
  crewMemberId: string;
  seatId: string;
  ctx: string | null;
  back: string;
  /** The acting admin's crew id (DEC-092) — the audit actor (#400, DEC-118). */
  actorId: string;
}> {
  const subject = await readSubject();
  const shiftId = String(formData.get("shiftId") ?? "");
  if (!subject || subject.kind !== "admin" || !shiftId) redirect("/admin/at-risk");
  const ctx = hostCtx(formData);
  return {
    shiftId,
    crewMemberId: String(formData.get("crewMemberId") ?? ""),
    seatId: String(formData.get("seatId") ?? ""),
    ctx,
    back: cockpitHref(shiftId, ctx),
    actorId: subject.id,
  };
}

/**
 * Best-effort crew audit append (#400, DEC-118) — post-mutation and NOT
 * transactional with the seat write: the domain action already committed, so an
 * audit hiccup must never fail it (same posture as `notify` above and the ask
 * loop's reliability appends). A crash in the gap drops one audit row.
 */
async function audit(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // best-effort — the seat write stands regardless
  }
}

function finish(shiftId: string, ctx: string | null, param: string): never {
  // The standalone route always revalidates; a pane host revalidates the board too.
  revalidatePath(`/admin/shift/${encodeURIComponent(shiftId)}`);
  if (ctx !== null) revalidatePath("/admin/shifts");
  redirect(cockpitHref(shiftId, ctx, param));
}

/**
 * Relay a "you're on / off this shift" assignment notice (DEC-084) — best-effort,
 * excluding the operator about their own action (DEC-072/084). Never throws: the
 * domain action already committed, so a channel hiccup must not fail it. Lands in
 * the /admin/outbox "Assignment changes" section (or straight out as SMS when
 * Twilio is configured — 9.4, DEC-MSG-1).
 */
async function notify(
  crewMemberId: string,
  action: "added" | "removed",
  shiftId: string,
): Promise<void> {
  if (!crewMemberId || crewMemberId === OPERATOR_CREW_MEMBER_ID) return;
  try {
    await forwardNoticesToOutbox([
      {
        crewMemberId: asId<"CrewMemberId">(crewMemberId),
        action,
        shiftId: asId<"ShiftId">(shiftId),
      },
    ]);
  } catch {
    // best-effort
  }
}

export async function assignTo(formData: FormData): Promise<void> {
  const { shiftId, crewMemberId, seatId, ctx, back } = await gate(formData);
  if (!seatId || !crewMemberId) redirect(back);
  let param: string;
  try {
    const out = await assignFromPool(
      getRepo(),
      asId<"SeatId">(seatId),
      asId<"CrewMemberId">(crewMemberId),
      new Date(),
    );
    param = out.error
      ? `act_error=${out.code ?? "unavailable"}`
      : `assigned=${encodeURIComponent(crewMemberId)}`;
    // Edge channel wiring (DEC-030): the fired ask → the pilot outbox.
    await forwardToOutbox(out.ask ? [out.ask] : undefined);
  } catch {
    param = "act_error=unavailable";
  }
  finish(shiftId, ctx, param);
}

export async function nudgeOn(formData: FormData): Promise<void> {
  const { shiftId, crewMemberId, ctx, back } = await gate(formData);
  if (!crewMemberId) redirect(back);
  let param: string;
  try {
    const out = await lean(
      getRepo(),
      asId<"ShiftId">(shiftId),
      asId<"CrewMemberId">(crewMemberId),
      new Date(),
    );
    param = out.error
      ? `act_error=${out.code ?? "unavailable"}`
      : `nudged=${encodeURIComponent(crewMemberId)}`;
    // Edge channel wiring (DEC-030): the fired ask → the pilot outbox.
    await forwardToOutbox(out.ask ? [out.ask] : undefined);
  } catch {
    param = "act_error=unavailable";
  }
  finish(shiftId, ctx, param);
}

export async function confirmInto(formData: FormData): Promise<void> {
  const { shiftId, seatId, ctx, back } = await gate(formData);
  if (!seatId) redirect(back);
  let param: string;
  try {
    const seat = await confirmSeat(getRepo(), asId<"SeatId">(seatId), new Date());
    param = seat?.assignedCrewMemberId
      ? `confirmed=${encodeURIComponent(String(seat.assignedCrewMemberId))}`
      : "act_error=not_claimed";
  } catch {
    param = "act_error=unavailable";
  }
  finish(shiftId, ctx, param);
}

export async function overrideTo(formData: FormData): Promise<void> {
  const { shiftId, crewMemberId, seatId, ctx, back, actorId } = await gate(formData);
  if (!seatId || !crewMemberId) redirect(back);
  const now = new Date();
  let param: string;
  try {
    const repo = getRepo();
    // Role-guarded (DEC-064): the override bypasses pool/rank/state but NOT the
    // role-competency floor — a mate can't be placed as captain even by a crafted
    // form post. Captains still place into mate seats (rated for both).
    const out = await overrideSeat(
      repo,
      asId<"SeatId">(seatId),
      asId<"CrewMemberId">(crewMemberId),
      now,
    );
    if (out.code === "not_rated") {
      param = "act_error=not_rated";
    } else if (out.code === "archived") {
      param = "act_error=archived";
    } else if (out.code === "gone") {
      param = "act_error=seat_gone";
    } else {
      param = `overrode=${encodeURIComponent(crewMemberId)}`;
      // DEC-084: the placed crew get a "you're on this shift" notice.
      await notify(crewMemberId, "added", shiftId);
      // Audit (#400, DEC-118): the operator force-placed this crew; if the override
      // bumped a different prior occupant, that's a distinct `crew_removed`.
      await audit(() =>
        logCrewAdded(repo, asId<"CrewMemberId">(crewMemberId), { kind: "admin", id: actorId }, now, {
          seatId: asId<"SeatId">(seatId),
          shiftId: asId<"ShiftId">(shiftId),
          via: "operator",
          ...(out.displaced !== undefined ? { displaced: out.displaced } : {}),
        }),
      );
      if (out.displaced !== undefined) {
        await audit(() =>
          logCrewRemoved(repo, out.displaced!, { kind: "admin", id: actorId }, now, {
            seatId: asId<"SeatId">(seatId),
            shiftId: asId<"ShiftId">(shiftId),
            reason: "displaced",
          }),
        );
      }
    }
  } catch {
    param = "act_error=unavailable";
  }
  finish(shiftId, ctx, param);
}

/**
 * No-penalty remove (#87) — the operator placed the wrong person; clear the seat
 * and re-ask, logging NO reliability event. Distinct from `reportBail`: same
 * occupant-pin race guard, but `vacateSeat` skips `logShiftBailed`, so a
 * correction never dings the removed crew's record.
 */
export async function removeSeat(formData: FormData): Promise<void> {
  const { shiftId, seatId, ctx, back, actorId } = await gate(formData);
  if (!seatId) redirect(back);
  const now = new Date();
  let param: string;
  try {
    const repo = getRepo();
    const seat = await repo.getSeat(asId<"SeatId">(seatId));
    if (!seat || seat.state !== "Confirmed" || !seat.assignedCrewMemberId) {
      param = "act_error=not_confirmed";
    } else if (seat.kind === "supernumerary") {
      // DEC-087: a staffed trainee comes off via unstaffTrainee (Manning
      // section) — vacate would re-ask a seat the engine ignores.
      param = "act_error=trainee_seat";
    } else {
      const occupant = seat.assignedCrewMemberId;
      try {
        const out = await vacateSeat(repo, seat.id, now, occupant);
        param = `removed=${encodeURIComponent(String(occupant))}`;
        // Edge channel wiring (DEC-030): the re-asks → the pilot outbox.
        await forwardToOutbox(out.reAsks);
        // DEC-084: the removed crew get a "you're off this shift" notice.
        await notify(String(occupant), "removed", shiftId);
        // Audit (#400, DEC-118): a no-penalty misassignment removal by the operator.
        await audit(() =>
          logCrewRemoved(repo, out.removed, { kind: "admin", id: actorId }, now, {
            seatId: seat.id,
            shiftId: asId<"ShiftId">(shiftId),
            reason: "misassignment",
          }),
        );
      } catch {
        // Occupant swapped between reads (or a write raced) — reload, don't
        // clear a different person than Spink saw.
        param = "act_error=raced";
      }
    }
  } catch {
    param = "act_error=unavailable";
  }
  finish(shiftId, ctx, param);
}

/**
 * Spink files a bail he heard about (#56 admin half, DEC-028) — the same
 * `bail()` rail the crew's own "can't make it" uses, lateness computed here at
 * report time (the DEC-028 caveat: stamped at report, not at the phone call —
 * the clamp bounds the damage). The penalized sibling of `removeSeat` (#87):
 * use this when the crew actually backed out, not for a misassignment.
 */
export async function reportBail(formData: FormData): Promise<void> {
  const { shiftId, seatId, ctx, back } = await gate(formData);
  if (!seatId) redirect(back);
  let param: string;
  try {
    const repo = getRepo();
    const seat = await repo.getSeat(asId<"SeatId">(seatId));
    if (!seat || seat.state !== "Confirmed" || !seat.assignedCrewMemberId) {
      param = "act_error=not_confirmed";
    } else if (seat.kind === "supernumerary") {
      // DEC-087: a trainee stepping off is not a bail — no reliability event.
      param = "act_error=trainee_seat";
    } else {
      // Lateness derived in core (DEC-028); occupant pinned so a swap between
      // reads maps to `raced`, never a wrong-person log.
      const bailer = seat.assignedCrewMemberId;
      const out = await bailWithDerivedLateness(repo, seat.id, new Date(), bailer);
      if (out.code === "raced" || out.code === "trainee_seat") {
        param = "act_error=raced";
      } else {
        param = `bail_logged=${encodeURIComponent(String(bailer))}`;
        // Edge channel wiring (DEC-030): the bail's re-asks → the pilot outbox.
        await forwardToOutbox(out.outcome?.reAsks);
        // DEC-084: an operator-reported bail tells the bailer they're off (a crew
        // self-bail doesn't — they initiated it). Only fires on a real log, not a race.
        await notify(String(bailer), "removed", shiftId);
      }
    }
  } catch {
    param = "act_error=unavailable";
  }
  finish(shiftId, ctx, param);
}

/**
 * Manning override (#208, 8.5) is WITHDRAWN from the UI. `ManningSection` no longer
 * renders, so nothing posts here — but a server action stays POST-reachable once its
 * id is known, so both entry points hard-reject rather than relying on the missing UI.
 *
 * Why it's gone: an added REQUIRED seat is born `Open`, and the tick asks on any
 * `required` seat regardless of `override` — so it fires real asks at real crew for a
 * seat the operator never meant to create (one stray click, no confirm step, no undo).
 * Once asked, the seat is unremovable: `removeOverrideSeat` demands `Open`, the vacate
 * path demands `Confirmed` + an occupant, and an `Asked` seat is neither. It then
 * accrues `ask_ignored` (−3) against innocent crew and reopens to be asked again.
 * Hit in prod on 2026-07-15 (Brew 4 / Jul 19); the seat needed a hand-written DELETE.
 *
 * The domain rails (`src/builder/manning.ts`) and their tests are intentionally kept —
 * this is a UI withdrawal, not a teardown. Anything reviving it must first make the
 * tick skip `override` seats, or add a confirm step, or both.
 */
export async function addManningSeat(_formData: FormData): Promise<void> {
  redirect("/admin/at-risk");
}

/** Withdrawn alongside `addManningSeat` — see above. */
export async function removeManningSeat(_formData: FormData): Promise<void> {
  redirect("/admin/at-risk");
}

/**
 * Staff a named person into a supernumerary/trainee seat (9.3/#224, DEC-087) —
 * the person half 8.5's placeholder seats were waiting for. Engine re-checks
 * the trainee rule set server-side (picker scope is UI convenience only); a
 * placed rider gets the DEC-084 "you're on this shift" notice, so Muster can
 * finally reach the trainee.
 */
export async function staffTrainee(formData: FormData): Promise<void> {
  const { shiftId, crewMemberId, seatId, ctx, back, actorId } = await gate(formData);
  if (!seatId || !crewMemberId) redirect(back);
  const now = new Date();
  let param: string;
  try {
    const repo = getRepo();
    const out = await staffTraineeSeat(
      repo,
      asId<"SeatId">(seatId),
      asId<"CrewMemberId">(crewMemberId),
      now,
    );
    if (out.code === null) {
      param = `trainee_on=${encodeURIComponent(crewMemberId)}`;
      // DEC-084: the rider gets a "you're on this shift" notice (best-effort,
      // operator excluded inside notify).
      await notify(crewMemberId, "added", shiftId);
      // Audit (#400, DEC-118): operator force-placed a trainee — same
      // operator-authority add DEC-118 tracks; deferred from Slice A, closed here.
      await audit(() =>
        logCrewAdded(repo, asId<"CrewMemberId">(crewMemberId), { kind: "admin", id: actorId }, now, {
          seatId: asId<"SeatId">(seatId),
          shiftId: asId<"ShiftId">(shiftId),
          via: "operator",
          reason: "trainee",
        }),
      );
    } else if (out.code === "ineligible") {
      param = "act_error=trainee_ineligible";
    } else if (out.code === "occupied") {
      param = "act_error=raced";
    } else {
      param = "act_error=seat_gone";
    }
  } catch {
    param = "act_error=unavailable";
  }
  finish(shiftId, ctx, param);
}

/**
 * Take the trainee back off the seat (DEC-087) — the bespoke no-re-ask unstaff
 * (NEVER vacateSeat: that path fires real asks for a seat the engine ignores).
 * Occupant-pinned like removeSeat, so a swap between reads maps to `raced`.
 * The removed rider gets the DEC-084 "you're off" notice.
 */
export async function unstaffTrainee(formData: FormData): Promise<void> {
  const { shiftId, crewMemberId, seatId, ctx, back, actorId } = await gate(formData);
  if (!seatId || !crewMemberId) redirect(back);
  const now = new Date();
  let param: string;
  try {
    const repo = getRepo();
    const out = await unstaffTraineeSeat(
      repo,
      asId<"SeatId">(seatId),
      asId<"CrewMemberId">(crewMemberId),
    );
    if (out.code === null) {
      param = `trainee_off=${encodeURIComponent(crewMemberId)}`;
      // DEC-084: the removed rider gets a "you're off" notice.
      await notify(crewMemberId, "removed", shiftId);
      // Audit (#400, DEC-118): operator pulled a trainee — the drop half, closed
      // here (deferred from Slice A).
      await audit(() =>
        logCrewRemoved(repo, asId<"CrewMemberId">(crewMemberId), { kind: "admin", id: actorId }, now, {
          seatId: asId<"SeatId">(seatId),
          shiftId: asId<"ShiftId">(shiftId),
          reason: "trainee",
        }),
      );
    } else if (out.code === "raced") {
      param = "act_error=raced";
    } else {
      param = "act_error=seat_gone";
    }
  } catch {
    param = "act_error=unavailable";
  }
  finish(shiftId, ctx, param);
}
