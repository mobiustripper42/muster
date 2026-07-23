import { AppLink } from "../../../components/ui/app-link";
import { SubmitButton } from "../../../components/ui/submit-button";
import { Notice } from "../../../components/ui/notice";
import { Shell } from "../../../components/ui/shell";
import { AdminSignedOut } from "../../../components/admin/admin-signed-out";
import { VersionTag } from "../../../components/ui/version-tag";
import { readSubject } from "../../lib/auth";
import { getRepo } from "../../lib/repo";
import { messagingEnabled } from "../../lib/flags";
import { setEnginePaused } from "./actions";

/**
 * Admin hub (Spink) — nav to every reachable surface (#100 Part B), plus the
 * engine arm/disarm control (#124, DEC-054). The At-Risk board is ranked FIRST
 * and heavier: it's the one surface that legitimately summons (push). The rest —
 * Outbox, Import, and the deliberate-PULL All-shifts view — are plainer links
 * below it, and All-shifts carries NO count badge (a badge would turn a pull
 * surface into ambient monitor-bait — DEC-042, BRAND). The per-shift cockpit is
 * reached from the boards, not listed here.
 */

export const dynamic = "force-dynamic";

type Search = { engine_error?: string };

export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;

  // Admin-gate inline, like every sibling admin surface (there's no (admin)
  // layout/middleware). Pre-#124 the hub was a static link list; now it reads
  // engine state + shows the operator control, so it must gate too.
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin")
    return <AdminSignedOut subject={subject} />;

  // Absent flag ⇒ running (DEC-054). A DB outage shows an unknown state rather
  // than 500-ing the hub.
  let paused: boolean | null;
  try {
    paused = await getRepo().isEnginePaused();
  } catch {
    paused = null;
  }

  return (
    <Shell width="3xl">
      <h1 className="text-xl font-semibold text-ink">Admin</h1>

      {sp.engine_error && (
        <Notice tone="bad">
          Couldn’t reach the engine setting — nothing changed. Try again.
        </Notice>
      )}

      {/* Engine arm/disarm (#124, DEC-054). The cron fires regardless; this flag
          decides whether a scheduled tick actually does anything. */}
      <EngineControl paused={paused} />

      {/* Primary / push: the board that summons you. */}
      <AppLink
        href="/admin/at-risk"
        className="flex flex-col gap-0.5 rounded-card border border-accent bg-card px-4 py-4 shadow-sm"
      >
        <span className="font-semibold text-accent">At-Risk board →</span>
        <span className="text-sm text-muted">
          The trips the automation couldn’t close. Empty is good.
        </span>
      </AppLink>

      {/* Secondary: the surfaces you reach for when you want them. */}
      <AppLink
        href="/admin/outbox"
        className="rounded-card border border-line bg-card px-4 py-3 font-semibold text-accent shadow-sm"
      >
        Outbox — asks waiting on your text →
      </AppLink>
      {messagingEnabled() && (
        <AppLink
          href="/admin/messages"
          className="rounded-card border border-line bg-card px-4 py-3 font-semibold text-accent shadow-sm"
        >
          Messages — post to crew &amp; read every thread →
        </AppLink>
      )}
      <AppLink
        href="/admin/import"
        className="rounded-card border border-line bg-card px-4 py-3 font-semibold text-accent shadow-sm"
      >
        Import — load this week’s Xola reservations →
      </AppLink>
      <AppLink
        href="/admin/shifts"
        className="rounded-card border border-line bg-card px-4 py-3 font-semibold text-accent shadow-sm"
      >
        All shifts — everything on the books, for reference →
      </AppLink>
      <AppLink
        href="/admin/time-off"
        className="rounded-card border border-line bg-card px-4 py-3 font-semibold text-accent shadow-sm"
      >
        Time off — who’s out, and set crew off →
      </AppLink>
      <AppLink
        href="/admin/asks"
        className="rounded-card border border-line bg-card px-4 py-3 font-semibold text-accent shadow-sm"
      >
        Audit — every crew add, drop, and change →
      </AppLink>
      <AppLink
        href="/admin/payroll"
        className="rounded-card border border-line bg-card px-4 py-3 font-semibold text-accent shadow-sm"
      >
        Payroll — estimated hours per crew, by pay period →
      </AppLink>
      <AppLink
        href="/admin/integrity"
        className="rounded-card border border-line bg-card px-4 py-3 font-semibold text-accent shadow-sm"
      >
        Integrity check — find references pointing at nothing →
      </AppLink>

      <VersionTag />
    </Shell>
  );
}

/** The engine pause/resume control. Server-rendered, no client JS (DEC-026):
 * the button posts the desired next state to `setEnginePaused`. */
function EngineControl({ paused }: { paused: boolean | null }) {
  if (paused === null) {
    return (
      <div className="rounded-card border border-line bg-card px-4 py-3">
        <p className="text-sm text-muted">
          Engine status unavailable — couldn’t reach the database.
        </p>
      </div>
    );
  }
  // State carries its own color — green when running, red when paused — so the
  // card itself is the status signal (no separate top-of-page notice).
  const tone = paused
    ? { card: "border-bad-line bg-bad-bg", text: "text-bad", msg: "No asks fire automatically" }
    : { card: "border-ok-line bg-ok-bg", text: "text-ok", msg: "Automation fires asks" };
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-card border px-4 py-4 shadow-sm ${tone.card}`}
    >
      <div className="flex flex-col gap-0.5">
        <span className={`font-semibold ${tone.text}`}>
          Engine: {paused ? "Paused" : "Running"}
        </span>
        <span className={`text-sm ${tone.text}`}>{tone.msg}</span>
      </div>
      <form action={setEnginePaused}>
        <input type="hidden" name="paused" value={String(!paused)} />
        {/* Button color = the state you'd switch TO (white card so it reads on
            the tinted status card). */}
        <SubmitButton
          className={`shrink-0 rounded-card border bg-card px-4 py-2 text-sm font-semibold shadow-sm ${
            paused ? "border-ok-line text-ok" : "border-bad-line text-bad"
          }`}
        >
          {paused ? "Resume staffing" : "Pause staffing"}
        </SubmitButton>
      </form>
    </div>
  );
}
