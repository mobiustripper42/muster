import { AppLink } from "../../../../components/ui/app-link";
import { SubmitButton } from "../../../../components/ui/submit-button";
import type { ImportRun, ImportRunSummary } from "@core/import/import-audit.js";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { readSubject } from "../../../lib/auth";
import { errCopyFor } from "../../../lib/err-copy";
import { fmtRunWhen, IMPORT_SOURCE_LABEL } from "../../../lib/format";
import { getRepo } from "../../../lib/repo";
import { logSwallowed } from "../../../lib/swallowed";
import { pullFromXola, type XolaPullErr } from "./actions";
import { ClearFeedbackParams } from "./clear-feedback-params";

/**
 * Import surface (DEC-043) — the operator's path to get live Xola trips onto the
 * board, and the ONLY one: the `/events` ⨝ `/orders` pull runs when this button is
 * pressed and at no other time. The hourly cron was removed in `13d3fb5` (the
 * operator wants to control when imports land) and is not coming back — every
 * import is manual. Admin-gated. A failed pull rides a redirect param (codes only,
 * DEC-026); a SUCCESSFUL pull redirects to its audit detail (#128) — the full
 * breakdown of what changed. The xlsx upload is retired (can't resolve a boat).
 */
export const dynamic = "force-dynamic";

/**
 * No `error` key and no fallback, unlike every other surface (#654). All three codes name a
 * specific cause and each already carries "nothing was pulled", so there is no generic line worth
 * showing — a hand-typed `?xerr=` renders no notice rather than a retry prompt for a failure that
 * did not happen. The other nine surfaces fall back to `error` because their actions have a real
 * catch-all path; this one does not.
 */
const ERR_COPY: Record<XolaPullErr, string> = {
  x_not_configured:
    "Xola isn’t configured on this server (XOLA_API_KEY / XOLA_SELLER_ID unset) — nothing was pulled.",
  x_auth:
    "Xola rejected the request — likely a bad API key, seller id, or missing permission. Check XOLA_API_KEY / XOLA_SELLER_ID. Nothing was pulled.",
  x_unavailable: "Couldn’t reach Xola — nothing was pulled. Try again in a moment.",
};

type Search = { xerr?: string; ximported?: string };

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin")
    return <AdminSignedOut subject={subject} />;

  const err = errCopyFor(ERR_COPY, sp.xerr);

  // Recent imports (#128 Part B) — the history list, drill-in to each run's
  // detail. A flaky DB just hides the list rather than 500-ing the pull button.
  let recent: ImportRun[] = [];
  try {
    recent = await getRepo().listImportRuns(20);
  } catch (e) {
    /* history unavailable — the Pull button still works */
    // An empty history list and a failed history read look identical on screen.
    logSwallowed("admin/import", e, "the recent-imports list was dropped");
  }

  return (
    <Shell width="2xl">
      {/* Strip the one-shot feedback params after render (#121, DEC-055) — the
          code never lingers in the URL or re-renders on reload. */}
      <ClearFeedbackParams />
      <header>
        <h1 className="text-xl font-semibold text-ink">Pull from Xola</h1>
        <p className="text-sm text-muted">
          Imports the next week of trips straight from the live Xola account and
          fills the board with the crew seats they need. Nothing imports on its
          own — trips reach the board when you press the button, and not before.
          Safe to press anytime (it updates in place, never duplicates).
        </p>
      </header>

      {err && <Notice tone="bad">{err}</Notice>}

      {/* Import succeeded but its audit detail couldn't be saved (#128) — the
          import is the contract, so say so honestly instead of an error. */}
      {sp.ximported && (
        <Notice tone="warn">
          ✓ Imported — the board’s updated.{" "}
          <AppLink href="/admin/at-risk" className="font-semibold text-accent">
            See the board →
          </AppLink>{" "}
          (Couldn’t save this run’s audit detail this time; nothing else is wrong.)
        </Notice>
      )}

      <form
        action={pullFromXola}
        className="flex flex-col gap-2 rounded-card border border-line bg-card px-4 py-4"
      >
        <span className="text-sm font-semibold text-ink">Pull the latest schedule</span>
        <p className="text-xs text-muted">
          This is the only way trips get imported — there’s no scheduled pull
          behind it. You’ll land on a full breakdown of what changed.
        </p>
        <SubmitButton className="mt-1 min-h-11 rounded-card bg-accent px-4 font-semibold text-white shadow-sm">
          Pull from Xola now
        </SubmitButton>
      </form>

      {recent.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">Recent imports</h2>
          <div className="flex flex-col gap-2">
            {recent.map((run) => (
              <AppLink
                key={run.id}
                href={`/admin/import/run/${run.id}`}
                spinner="overlay"
                className="relative flex flex-col gap-0.5 rounded-card border border-line bg-card px-4 py-3 shadow-sm"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink">
                    {IMPORT_SOURCE_LABEL[run.source] ?? run.source}
                  </span>
                  <span className="text-xs text-muted">{fmtRunWhen(run.ranAt)}</span>
                </span>
                <span className="text-xs text-muted">{summaryLine(run.summary)}</span>
              </AppLink>
            ))}
          </div>
        </section>
      )}

    </Shell>
  );
}

/** One-line count digest for a history row; flags unknown boats inline (the one
 * alert worth seeing without drilling in). */
function summaryLine(s: ImportRunSummary): string {
  const parts = [
    `${s.reservationsAdded} new`,
    `${s.reservationsUpdated} updated`,
    `${s.shiftsCreated} shift${s.shiftsCreated === 1 ? "" : "s"} formed`,
  ];
  if (s.shiftsCancelled > 0) parts.push(`${s.shiftsCancelled} cancelled`);
  if (s.unmappedResources.length > 0)
    parts.push(
      `⚠ ${s.unmappedResources.length} unknown boat${s.unmappedResources.length === 1 ? "" : "s"}`,
    );
  return parts.join(" · ");
}
