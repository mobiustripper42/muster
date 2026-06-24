"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { XolaError } from "@core/import/xola-client.js";
import { readSubject } from "../../../lib/auth";
import { persistImportRun } from "../../../lib/import-audit";
import { getRepo } from "../../../lib/repo";
import { runXolaPull } from "../../../lib/xola";

/**
 * Pull live reservations from Xola on demand (DEC-043) — the operator button atop
 * the same hourly `runXolaPull`. Reuses the import seam: pull the
 * [today−1, today+horizon] window of `/events` ⨝ `/orders` → import → form shifts.
 * Admin-gated. The run is persisted as an audit record (#128, DEC-056) and we
 * redirect to its detail view — the same surface a cron run is reviewed on — so
 * "what did that pull do?" is answerable, not a one-line count that vanished.
 *
 * The xlsx upload is retired (DEC-043): the spreadsheet carries no Resource column,
 * so it can't resolve a boat — the live pull is the only ingest.
 */
export async function pullFromXola(): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin/import");

  const now = new Date();
  const repo = getRepo();
  let runId: string;
  try {
    const r = await runXolaPull(repo, now);
    if (r.unmappedResources.length) {
      // Still worth a dev log — the audit record names them, but an unknown boat
      // is the one alert worth seeing in the server logs too.
      console.warn(
        `[xola-pull] ${r.unmappedResources.length} UNKNOWN resource id(s) — a new/renamed boat to add to resource-map.ts:`,
        r.unmappedResources.map((s) => s.reason),
      );
    }
    runId = await persistImportRun(repo, r, "manual-pull", now);
  } catch (e) {
    // Log the real error server-side (#121): a 4xx used to read as a transient
    // blip with an empty console — that cost a debugging session. Distinguish
    // three causes so the operator copy + the dev's log both tell the truth:
    //   env unset → x_not_configured · Xola 4xx (bad key/seller/perms) → x_auth ·
    //   5xx / network / anything else → x_unavailable ("try again").
    console.error("[xola-pull] manual pull failed:", e);
    const code =
      e instanceof Error && /not configured/i.test(e.message)
        ? "x_not_configured"
        : e instanceof XolaError &&
            e.status !== undefined &&
            e.status >= 400 &&
            e.status < 500
          ? "x_auth"
          : "x_unavailable";
    redirect(`/admin/import?xerr=${code}`);
  }
  revalidatePath("/admin/at-risk");
  redirect(`/admin/import/run/${runId}`);
}
