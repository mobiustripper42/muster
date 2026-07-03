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
import { addOverrideSeat, removeOverrideSeat } from "@core/builder/manning.js";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../../../lib/auth";
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

/** Auth + the form's ids, or redirect out. Shared head of every action. */
async function gate(formData: FormData): Promise<{
  shiftId: string;
  crewMemberId: string;
  seatId: string;
  back: string;
}> {
  const subject = await readSubject();
  const shiftId = String(formData.get("shiftId") ?? "");
  if (!subject || subject.kind !== "admin" || !shiftId) redirect("/admin/at-risk");
  return {
    shiftId,
    crewMemberId: String(formData.get("crewMemberId") ?? ""),
    seatId: String(formData.get("seatId") ?? ""),
    back: `/admin/shift/${encodeURIComponent(shiftId)}`,
  };
}

function finish(back: string, param: string): never {
  revalidatePath(back);
  redirect(`${back}?${param}`);
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
  const { crewMemberId, seatId, back } = await gate(formData);
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
  finish(back, param);
}

export async function nudgeOn(formData: FormData): Promise<void> {
  const { shiftId, crewMemberId, back } = await gate(formData);
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
  finish(back, param);
}

export async function confirmInto(formData: FormData): Promise<void> {
  const { seatId, back } = await gate(formData);
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
  finish(back, param);
}

export async function overrideTo(formData: FormData): Promise<void> {
  const { shiftId, crewMemberId, seatId, back } = await gate(formData);
  if (!seatId || !crewMemberId) redirect(back);
  let param: string;
  try {
    // Role-guarded (DEC-064): the override bypasses pool/rank/state but NOT the
    // role-competency floor — a mate can't be placed as captain even by a crafted
    // form post. Captains still place into mate seats (rated for both).
    const out = await overrideSeat(
      getRepo(),
      asId<"SeatId">(seatId),
      asId<"CrewMemberId">(crewMemberId),
      new Date(),
    );
    if (out.code === "not_rated") {
      param = "act_error=not_rated";
    } else if (out.code === "gone") {
      param = "act_error=seat_gone";
    } else {
      param = `overrode=${encodeURIComponent(crewMemberId)}`;
      // DEC-084: the placed crew get a "you're on this shift" notice.
      await notify(crewMemberId, "added", shiftId);
    }
  } catch {
    param = "act_error=unavailable";
  }
  finish(back, param);
}

/**
 * No-penalty remove (#87) — the operator placed the wrong person; clear the seat
 * and re-ask, logging NO reliability event. Distinct from `reportBail`: same
 * occupant-pin race guard, but `vacateSeat` skips `logShiftBailed`, so a
 * correction never dings the removed crew's record.
 */
export async function removeSeat(formData: FormData): Promise<void> {
  const { shiftId, seatId, back } = await gate(formData);
  if (!seatId) redirect(back);
  let param: string;
  try {
    const repo = getRepo();
    const seat = await repo.getSeat(asId<"SeatId">(seatId));
    if (!seat || seat.state !== "Confirmed" || !seat.assignedCrewMemberId) {
      param = "act_error=not_confirmed";
    } else {
      const occupant = seat.assignedCrewMemberId;
      try {
        const out = await vacateSeat(repo, seat.id, new Date(), occupant);
        param = `removed=${encodeURIComponent(String(occupant))}`;
        // Edge channel wiring (DEC-030): the re-asks → the pilot outbox.
        await forwardToOutbox(out.reAsks);
        // DEC-084: the removed crew get a "you're off this shift" notice.
        await notify(String(occupant), "removed", shiftId);
      } catch {
        // Occupant swapped between reads (or a write raced) — reload, don't
        // clear a different person than Spink saw.
        param = "act_error=raced";
      }
    }
  } catch {
    param = "act_error=unavailable";
  }
  finish(back, param);
}

/**
 * Spink files a bail he heard about (#56 admin half, DEC-028) — the same
 * `bail()` rail the crew's own "can't make it" uses, lateness computed here at
 * report time (the DEC-028 caveat: stamped at report, not at the phone call —
 * the clamp bounds the damage). The penalized sibling of `removeSeat` (#87):
 * use this when the crew actually backed out, not for a misassignment.
 */
export async function reportBail(formData: FormData): Promise<void> {
  const { shiftId, seatId, back } = await gate(formData);
  if (!seatId) redirect(back);
  let param: string;
  try {
    const repo = getRepo();
    const seat = await repo.getSeat(asId<"SeatId">(seatId));
    if (!seat || seat.state !== "Confirmed" || !seat.assignedCrewMemberId) {
      param = "act_error=not_confirmed";
    } else {
      // Lateness derived in core (DEC-028); occupant pinned so a swap between
      // reads maps to `raced`, never a wrong-person log.
      const bailer = seat.assignedCrewMemberId;
      const out = await bailWithDerivedLateness(repo, seat.id, new Date(), bailer);
      if (out.code === "raced") {
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
  finish(back, param);
}

/**
 * Add a manning-override seat (#208, 8.5) — a required hand (gates `Crewed`) or a
 * supernumerary/trainee (non-gating). Additive over the COI minimum; the seat is
 * marked `override` so `formShifts` won't prune it (survives Xola re-import). Not the
 * person-override (`overrideTo`) — this adds the SEAT.
 */
export async function addManningSeat(formData: FormData): Promise<void> {
  const subject = await readSubject();
  const shiftId = String(formData.get("shiftId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const role = String(formData.get("role") ?? "");
  const back = `/admin/shift/${encodeURIComponent(shiftId)}`;
  if (!subject || subject.kind !== "admin" || !shiftId) redirect("/admin/at-risk");
  if ((kind !== "required" && kind !== "supernumerary") || !role) redirect(back);
  let param: string;
  try {
    const repo = getRepo();
    // Validate the role against the tenant's roles — a crafted POST must not create
    // a REQUIRED seat for an unknown role (it would gate Crewed with an empty
    // eligible pool → permanently unfillable, silently un-crewing the shift).
    const roles = await repo.listRoleTypes(TENANT_ID);
    if (!roles.some((r) => String(r.id) === role)) {
      param = "act_error=unavailable";
    } else {
      await addOverrideSeat(repo, asId<"ShiftId">(shiftId), kind, asId<"RoleTypeId">(role));
      param = `manning_added=${kind}`;
    }
  } catch {
    param = "act_error=unavailable";
  }
  finish(back, param);
}

/**
 * Remove a manning-override seat (#208, 8.5). Guarded in `removeOverrideSeat`: only an
 * `Open` override seat — an occupied one must be vacated first (the Remove-from-shift
 * action above), so this never strands crew. The UI only offers Remove on Open
 * override seats, so a reachable failure is a race → generic `seat_gone`.
 */
export async function removeManningSeat(formData: FormData): Promise<void> {
  const subject = await readSubject();
  const shiftId = String(formData.get("shiftId") ?? "");
  const seatId = String(formData.get("seatId") ?? "");
  const back = `/admin/shift/${encodeURIComponent(shiftId)}`;
  if (!subject || subject.kind !== "admin" || !shiftId || !seatId) {
    redirect("/admin/at-risk");
  }
  let param: string;
  try {
    await removeOverrideSeat(getRepo(), asId<"SeatId">(seatId));
    param = "manning_removed=1";
  } catch {
    param = "act_error=seat_gone";
  }
  finish(back, param);
}
