"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { runXolaPull } from "../../../lib/xola";

/**
 * Pull live reservations from Xola on demand (DEC-043) — the operator button atop
 * the same hourly `runXolaPull`. Reuses the import seam: pull the
 * [today−1, today+horizon] window of `/events` ⨝ `/orders` → import → form shifts.
 * Admin-gated. Counts ride redirect params (codes only, DEC-026); the per-pull
 * assignment summary + any skips/unknown boats are logged server-side for the dev.
 *
 * The xlsx upload is retired (DEC-043): the spreadsheet carries no Resource column,
 * so it can't resolve a boat — the live pull is the only ingest.
 */
export async function pullFromXola(): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin/import");

  let params: string;
  try {
    const r = await runXolaPull(getRepo(), new Date());
    if (r.import.skipped.length) {
      console.warn(
        `[xola-pull] ${r.import.skipped.length} record(s) skipped:`,
        r.import.skipped.map((s) => s.reason),
      );
    }
    if (r.unmappedResources.length) {
      console.warn(
        `[xola-pull] ${r.unmappedResources.length} UNKNOWN resource id(s) — a new/renamed boat to add to resource-map.ts:`,
        r.unmappedResources.map((s) => s.reason),
      );
    }
    // The per-day boat→times view (the operator's bad-assignment review surface) —
    // logged for the dev; the operator's live view is /admin/shifts + the board.
    console.info("[xola-pull] assignments:", JSON.stringify(r.assignments));

    params = new URLSearchParams({
      xpull: "1",
      fetched: String(r.ordersFetched),
      added: String(r.import.reservationsAdded),
      updated: String(r.import.reservationsUpdated),
      cancelled: String(r.import.reservationsNewlyCancelled),
      events: String(r.import.eventsCreated),
      shifts: String(r.form.shiftsCreated),
      shiftsCancelled: String(r.form.shiftsCancelled),
      skipped: String(r.import.skipped.length),
      unmapped: String(r.unmappedResources.length),
    }).toString();
  } catch (e) {
    // Config gap (env unset) reads differently from Xola unreachable / any other
    // throw → the generic "try again".
    const code =
      e instanceof Error && /not configured/i.test(e.message)
        ? "x_not_configured"
        : "x_unavailable";
    redirect(`/admin/import?xerr=${code}`);
  }
  revalidatePath("/admin/at-risk");
  redirect(`/admin/import?${params}`);
}
