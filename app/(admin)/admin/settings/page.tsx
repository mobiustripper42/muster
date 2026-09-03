import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { EngineControl } from "../../../../components/admin/engine-control";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { logSwallowed } from "../../../lib/swallowed";

/**
 * Admin settings (#603) — the home the engine pause/resume control never had.
 *
 * It existed only on the `/admin` hub, which is why "Settings ▸ Pause staffing" could not be a
 * nav entry until now: a menu item that 404s is worse than a missing one. Everything else the
 * hub linked already had its own page; this was the exception.
 *
 * Deliberately thin. It is not a preferences screen — the tunables that matter
 * (`STAFFING_HORIZON_LEAD_DAYS`, `FILL_DEADLINE_HOURS`, `ASK_SILENT_TIMEOUT_MINUTES`) are
 * env-overridable per deploy by design (DEC-062) and are not the operator's to edit from a
 * browser. This surface holds operational state — things that change on a Tuesday, not at deploy
 * time — and today there is exactly one.
 */

export const dynamic = "force-dynamic";

type Search = { engine_error?: string };

export default async function AdminSettings({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;

  // Admin-gate inline, like every sibling admin surface (there is no (admin) middleware).
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  // Absent flag ⇒ running (DEC-054). A DB outage shows an unknown state rather than 500-ing.
  let paused: boolean | null;
  try {
    paused = await getRepo().isEnginePaused();
  } catch (e) {
    // `null` renders "unknown state" rather than 500-ing, which is right — but it
    // is also what the operator sees for a healthy-but-unreadable flag, so the
    // screen cannot distinguish "we don't know" from "we couldn't ask".
    logSwallowed("admin/settings", e, "the engine-paused flag was unreadable — the control shows an unknown state");
    paused = null;
  }

  return (
    <Shell width="3xl">
      <h1 className="text-xl font-semibold text-ink">Settings</h1>

      {sp.engine_error && (
        <Notice tone="bad">Couldn’t reach the engine setting — nothing changed. Try again.</Notice>
      )}

      {/* Engine arm/disarm (#124, DEC-054). The cron fires regardless; this flag decides whether
          a scheduled tick actually does anything. */}
      <EngineControl paused={paused} />
      <p className="text-sm text-muted">
        Pausing stops the engine asking anyone. Shifts still derive their state, the importer still
        runs, and crew can still answer asks already sent — nothing new goes out until you resume.
      </p>

      <VersionTag />
    </Shell>
  );
}
