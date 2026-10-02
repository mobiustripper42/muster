"use server";

import { redirect } from "next/navigation";
import {
  setGuestAboard,
  setPassengerCount,
  type AboardResult,
  type CountResult,
} from "@core/checkin/check-in.js";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../../../../../lib/auth";
import { getRepo } from "../../../../../../lib/repo";
import { logSwallowed } from "../../../../../../lib/swallowed";

/**
 * Crew check-in's writes (Phase 18.5a, issue #1119). Every rule — who may, the boat's limit, the
 * count's range — is the core's (`src/checkin/check-in.ts`), asked again on every write.
 *
 * Two shapes for a tick, because the list works both ways (DEC-147):
 * - `tickGuest` is the island's callback: it RETURNS the outcome and never redirects, so a tap
 *   moves the row at once and only a refusal or a failure moves it back.
 * - `tickGuestForm` is the same write as a plain form post, for a phone without JS: it redirects
 *   back to the page, carrying a code (never prose) when it was refused.
 *
 * `redirect()` throws, so it stays outside every try (house convention).
 */

/** Every code these actions can put in `?err=` — mapped to copy on the page. */
export type CheckInErr = "full" | "not_found" | "bad_count" | "error";

export type TickOutcome = AboardResult | "error";

/** The island's tick or untick. A crew session is required; anything else is `not_allowed`. */
export async function tickGuest(
  shiftId: string,
  eventId: string,
  guestId: string,
  aboard: boolean,
): Promise<TickOutcome> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") return "not_allowed";
  try {
    return await setGuestAboard(getRepo(), {
      shiftId: asId<"ShiftId">(shiftId),
      eventId: asId<"EventId">(eventId),
      guestId: asId<"GuestId">(guestId),
      crewId: asId<"CrewMemberId">(subject.id),
      aboard,
      now: new Date().toISOString(),
    });
  } catch (e) {
    logSwallowed("crew/check-in:tickGuest", e, "a check-in tick was not saved");
    return "error";
  }
}

/** The same tick as a form post (no JS). */
export async function tickGuestForm(formData: FormData): Promise<void> {
  const shiftId = String(formData.get("shiftId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  const outcome = await tickGuest(shiftId, eventId, String(formData.get("guestId") ?? ""), formData.get("aboard") === "1");
  redirect(pageHref(shiftId, eventId, outcome === "ok" ? null : errFor(outcome)));
}

/** Confirm or update the passenger count. */
export async function confirmCount(formData: FormData): Promise<void> {
  const shiftId = String(formData.get("shiftId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  const raw = String(formData.get("pax") ?? "").trim();
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");

  let outcome: CountResult | "error";
  try {
    outcome = await setPassengerCount(getRepo(), {
      shiftId: asId<"ShiftId">(shiftId),
      eventId: asId<"EventId">(eventId),
      crewId: asId<"CrewMemberId">(subject.id),
      // A blank box reads as missing, never as 0.
      pax: raw === "" ? Number.NaN : Number(raw),
      now: new Date().toISOString(),
    });
  } catch (e) {
    logSwallowed("crew/check-in:confirmCount", e, "a passenger count was not saved");
    outcome = "error";
  }
  redirect(pageHref(shiftId, eventId, outcome === "ok" ? null : errFor(outcome)));
}

/** A departure the crew member may not check in reads as not found: no detail either way. */
function errFor(outcome: Exclude<TickOutcome | CountResult, "ok">): CheckInErr {
  if (outcome === "not_allowed") return "not_found";
  return outcome;
}

function pageHref(shiftId: string, eventId: string, err: CheckInErr | null): string {
  const base = `/crew/shift/${encodeURIComponent(shiftId)}/check-in/${encodeURIComponent(eventId)}`;
  return err ? `${base}?err=${err}` : base;
}
