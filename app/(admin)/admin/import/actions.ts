"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { XolaError } from "@core/import/xola-client.js";
import type { XolaPullResult } from "@core/import/xola-pull.js";
import { logFormAudit } from "@core/oracle/audit-log.js";
import { readSubject } from "../../../lib/auth";
import { persistImportRun } from "../../../lib/import-audit";
import { getRepo } from "../../../lib/repo";
import { runXolaPull } from "../../../lib/xola";

/**
 * Every code this surface can put in `?xerr=` (#654). Unlike the other admin surfaces these are
 * minted entirely here rather than returned by a domain door — the three causes #121 distinguishes
 * (env unset, Xola 4xx, 5xx/network) are a property of the HTTP call, not of a validation rule.
 * Consumed by the page's copy table, so a fourth cause cannot be added without saying what it
 * means to the operator.
 */
export type XolaPullErr = "x_not_configured" | "x_auth" | "x_unavailable";

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

  // The IMPORT is the contract. Its failure (and only its failure) means "nothing
  // was pulled" (#128 code-review). Map three causes (#121): env unset →
  // x_not_configured · Xola 4xx (bad key/seller/perms) → x_auth · 5xx / network →
  // x_unavailable. The real error is logged — a 4xx used to vanish into an empty
  // console (cost a debugging session).
  let result: XolaPullResult;
  try {
    result = await runXolaPull(repo, now);
  } catch (e) {
    console.error("[xola-pull] manual pull failed:", e);
    const code: XolaPullErr =
      e instanceof Error && /not configured/i.test(e.message)
        ? "x_not_configured"
        // eslint-disable-next-line sonarjs/no-nested-conditional -- baselined, lift to a named function (#928)
        : e instanceof XolaError &&
            e.status !== undefined &&
            e.status >= 400 &&
            e.status < 500
          ? "x_auth"
          : "x_unavailable";
    redirect(`/admin/import?xerr=${code}`);
  }

  if (result.unmappedResources.length) {
    // Worth a dev log too — the audit record names them, but an unknown boat is
    // the one alert worth seeing in the server logs.
    console.warn(
      `[xola-pull] ${result.unmappedResources.length} UNKNOWN resource id(s) — a new/renamed boat to add to resource-map.ts:`,
      result.unmappedResources.map((s) => s.reason),
    );
  }

  // The AUDIT is best-effort — the import already committed (reservations saved,
  // shifts formed). A failed audit write must NOT tell the operator "nothing was
  // pulled". Saved → its detail view; failed → land on /admin/import with an
  // honest "imported, audit unavailable" notice.
  let runId: string | null = null;
  try {
    runId = await persistImportRun(repo, result, "manual-pull", now);
  } catch (e) {
    console.error("[xola-pull] audit persist failed (import succeeded):", e);
  }

  // Crew audit (#400, DEC-118): every crew transition an import drove gets an audit
  // row, actor `importer:xola` (shift_changed / crew_removed / crew_added). Best-
  // effort, post-commit — the import already stands. Emitted here (not in
  // runXolaPull) so the reviewable `runId` rides the metadata. Previously only
  // `changedCrew` was logged, so an import that CANCELLED a shift removed its crew
  // with no `crew_removed` row — the "you're off" SMS fired but left no audit trail,
  // unlike an admin vacate.
  await logFormAudit(repo, result.form, { kind: "importer", id: "xola" }, now, runId ? { runId } : {});

  revalidatePath("/admin/at-risk");
  redirect(runId ? `/admin/import/run/${runId}` : "/admin/import?ximported=1");
}
