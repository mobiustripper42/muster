"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  releaseVesselHoldAdmin,
  saveVesselHoldAdmin,
  type VesselHoldReleaseError,
  type VesselHoldSaveError,
} from "@core/admin/block-admin.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

/**
 * The calendar's two writes (#703) — take one departure off the market, and put it back.
 * Auth + FormData glue over the domain doors, which own validation; same shape as the
 * /admin/blocks actions, including `redirect()` living outside the try (it throws, house
 * convention).
 *
 * Both are reached from a CONFIRM step (`?hold=` / `?release=` renders a banner over the grid),
 * so a stray POST is the only way to arrive here unasked — which is why the domain doors, not
 * this glue, hold the staleness guards.
 */

/** Every code this surface can put in `?err=` (#654) — declared beside the redirects minting it. */
export type CalendarErr = VesselHoldSaveError | VesselHoldReleaseError | "error";

/** Rebuild the grid href the operator came from, so a write never loses their day or filter. */
function backTo(formData: FormData, err: CalendarErr | null): string {
  const params = new URLSearchParams();
  const date = String(formData.get("date") ?? "").trim();
  const filter = String(formData.get("filter") ?? "").trim();
  // `today` is omitted from the href by the grid's own `calendarHref`; here the date is always
  // explicit, which is harmless (it resolves to the same day) and keeps this glue clock-free.
  if (date) params.set("date", date);
  if (filter && filter !== "all") params.set("filter", filter);
  if (err) params.set("err", err);
  const q = params.toString();
  return q ? `/admin/calendar?${q}` : "/admin/calendar";
}

/**
 * Hold a single departure. The id is minted here (as on /admin/blocks) — the calendar never
 * edits a hold in place, so every submit is a create or a refusal.
 */
export async function holdSlot(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  let code: CalendarErr | null = null;
  try {
    const result = await saveVesselHoldAdmin(getRepo(), {
      id: `block-${randomUUID()}`,
      vesselId: String(formData.get("vesselId") ?? ""),
      date: String(formData.get("date") ?? ""),
      time: String(formData.get("time") ?? ""),
    });
    code = result.ok ? null : result.code;
  } catch (e) {
    console.error("holdSlot: saveVesselHoldAdmin threw", e);
    code = "error";
  }

  revalidatePath("/admin/calendar");
  revalidatePath("/admin/blocks");
  redirect(backTo(formData, code));
}

/** Put a held departure back on sale — the calendar's half of Lift, scoped to holds. */
export async function releaseHold(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  let code: CalendarErr | null = null;
  try {
    const result = await releaseVesselHoldAdmin(
      getRepo(),
      String(formData.get("id") ?? "").trim(),
    );
    code = result.ok ? null : result.code;
  } catch (e) {
    console.error("releaseHold: releaseVesselHoldAdmin threw", e);
    code = "error";
  }

  revalidatePath("/admin/calendar");
  revalidatePath("/admin/blocks");
  redirect(backTo(formData, code));
}
