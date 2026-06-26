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
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../../../lib/auth";
import { forwardToOutbox } from "../../../../lib/channel";
import { getRepo } from "../../../../lib/repo";

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
  const { crewMemberId, seatId, back } = await gate(formData);
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
    param =
      out.code === "not_rated"
        ? "act_error=not_rated"
        : out.code === "gone"
          ? "act_error=seat_gone"
          : `overrode=${encodeURIComponent(crewMemberId)}`;
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
  const { seatId, back } = await gate(formData);
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
  const { seatId, back } = await gate(formData);
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
      param =
        out.code === "raced"
          ? "act_error=raced"
          : `bail_logged=${encodeURIComponent(String(bailer))}`;
      // Edge channel wiring (DEC-030): the bail's re-asks → the pilot outbox.
      await forwardToOutbox(out.outcome?.reAsks);
    }
  } catch {
    param = "act_error=unavailable";
  }
  finish(back, param);
}
