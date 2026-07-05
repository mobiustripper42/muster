import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  buildClaimableView,
  type ClaimableSeatView,
  type DateRange,
} from "@core/crewapp/claimable-view.js";
import { addDays, vesselDateOf } from "@core/config/tenant.js";
import { asId } from "@core/domain/ids.js";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { selfServeEnabled } from "../../../lib/flags";
import { getRepo } from "../../../lib/repo";
import { fmt12 } from "../../../lib/format";
import { claimSeat } from "./actions";

/**
 * /crew/open (SPEC §2.7.1, DEC-074) — the crew-facing PULL surface, the 4th crew
 * surface (a knowing exception to "three surfaces"). Lists the viewer's claimable
 * Open seats and lets them claim one (auto-lock, DEC-075). Inherits DEC-042's
 * anti-anxiety guardrails: default filter = today (+ weekend / from–to presets),
 * [today, today+45d] clamp (owned by `claimableSeatsFor`), NO auto-refresh / NO
 * polling / NO live per-state counts (a bare row count for orientation is fine),
 * neutral ink (warm/bad tokens stay reserved for the At-Risk board).
 *
 * Server-rendered, no client JS: presets are GET links, the confirm "sheet" is a
 * native <details> disclosure (the bail pattern), Claim is a <form action>.
 * Flag-gated (DEC-059): 404 in prod until CREW_SELF_SERVE is on.
 */
export const dynamic = "force-dynamic"; // DEC-042: dynamic on navigation, never polled

const CLAIM_ERROR_COPY: Record<string, string> = {
  just_taken: "Someone grabbed that one first — here’s what’s still open.",
  conflict: "You already have a shift that day — one boat per day is the rule.",
  unavailable: "Couldn’t claim that just now — here’s the current list.",
};

type Search = { range?: string; from?: string; to?: string; claim_error?: string };

export default async function CrewOpenPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  if (!selfServeEnabled()) notFound(); // dark in prod until the flag flips (DEC-059)
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew"); // /crew owns the login UI

  const today = vesselDateOf(new Date());
  const { range, label } = resolveRange(sp, today);
  const back = backHref(label, sp);

  let rows: ClaimableSeatView[];
  try {
    rows = await buildClaimableView(
      getRepo(),
      asId<"CrewMemberId">(subject.id),
      new Date(),
      range,
    );
  } catch {
    return (
      <Shell>
        <BackLink />
        <Notice>Can’t reach the schedule right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const claimError = sp.claim_error ? CLAIM_ERROR_COPY[sp.claim_error] ?? null : null;

  return (
    <Shell>
      <BackLink />
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-ink">Pick up a shift</h1>
        <p className="text-sm text-muted">
          Open spots you’re cleared for. Claiming locks you in for the whole day.
        </p>
      </header>

      <Filters label={label} today={today} sp={sp} />

      {claimError && <Notice>{claimError}</Notice>}

      {rows.length === 0 ? (
        <Notice>Nothing open in this window. Check back, or widen the dates above.</Notice>
      ) : (
        <section className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wide text-muted">
            {rows.length} open
          </p>
          {rows.map((r) => (
            <ClaimRow key={r.seatId} row={r} back={back} />
          ))}
        </section>
      )}

      <VersionTag />
    </Shell>
  );
}

function BackLink() {
  return (
    <Link href="/crew" className="text-sm font-semibold text-accent">
      ‹ Shifts
    </Link>
  );
}

/** Today / This weekend presets (links) + a from–to GET form. Active = filled. */
function Filters({
  label,
  today,
  sp,
}: {
  label: RangeLabel;
  today: string;
  sp: Search;
}) {
  const chip = (active: boolean) =>
    `inline-flex min-h-[36px] items-center rounded-full border px-3 text-sm font-semibold ${
      active
        ? "border-accent bg-accent text-white"
        : "border-line bg-card text-muted"
    }`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Link href="/crew/open" className={chip(label === "today")}>
          Today
        </Link>
        <Link href="/crew/open?range=weekend" className={chip(label === "weekend")}>
          This weekend
        </Link>
      </div>
      {/* No-JS date range: a GET form submits ?from&to back to this page. */}
      <form method="get" action="/crew/open" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-muted">
          From
          <input
            type="date"
            name="from"
            defaultValue={label === "range" ? sp.from : today}
            min={today}
            className="min-h-[40px] rounded-card border border-line bg-card px-2 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col text-xs text-muted">
          To
          <input
            type="date"
            name="to"
            defaultValue={label === "range" ? sp.to : addDays(today, 45)}
            max={addDays(today, 45)}
            className="min-h-[40px] rounded-card border border-line bg-card px-2 text-sm text-ink"
          />
        </label>
        <button
          type="submit"
          className={`min-h-[40px] rounded-card border px-3 text-sm font-semibold ${
            label === "range"
              ? "border-accent bg-accent text-white"
              : "border-line bg-card text-accent"
          }`}
        >
          Go
        </button>
      </form>
    </div>
  );
}

/** One claimable seat: a <details> whose open state is the DEC-077 confirm sheet. */
function ClaimRow({ row, back }: { row: ClaimableSeatView; back: string }) {
  const window =
    row.callTime && row.shiftEndTime
      ? `${fmt12(row.callTime)} → ~${approxBack(row.shiftEndTime)}`
      : "times TBD";
  return (
    <details className="group overflow-hidden rounded-card border border-line bg-card shadow-sm">
      <summary className="flex min-h-[44px] cursor-pointer items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex flex-col">
          <span className="font-semibold text-ink">{fmtDate(row.date)}</span>
          <span className="text-sm text-muted">
            {row.vesselName} · {row.roleName} · {window}
          </span>
        </span>
        <span
          className="text-faint transition-transform group-open:rotate-90"
          aria-hidden
        >
          ›
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
        <p className="text-sm text-muted">{confirmCopy(row)}</p>
        <form action={claimSeat}>
          <input type="hidden" name="seatId" value={row.seatId} />
          <input type="hidden" name="back" value={back} />
          <SubmitButton className="min-h-[44px] w-full rounded-lg border border-accent bg-accent px-4 font-semibold text-white">
            Claim this shift
          </SubmitButton>
        </form>
      </div>
    </details>
  );
}

/** The DEC-077 confirm copy: whole-day scope + live trip count/times + window. */
function confirmCopy(r: ClaimableSeatView): string {
  const head = `Claim ${fmtDate(r.date)} on ${r.vesselName} as ${r.roleName.toLowerCase()}? That’s the whole day — every trip booked, including any added later.`;
  if (r.tripTimes.length === 0 || !r.callTime || !r.shiftEndTime) {
    return `${head} No trips are scheduled yet.`;
  }
  const trips = r.tripTimes.map(fmt12).join(" & ");
  const n = r.tripTimes.length;
  return `${head} Right now: ${n} trip${n === 1 ? "" : "s"} (${trips}), call ${fmt12(r.callTime)}, back ~${approxBack(r.shiftEndTime)}.`;
}

type RangeLabel = "today" | "weekend" | "range";

/** Resolve the active date range from search params (default today). */
function resolveRange(sp: Search, today: string): { range: DateRange; label: RangeLabel } {
  if (sp.from && sp.to) {
    // Tolerate a backwards range (from > to) — swap rather than render a confusing
    // empty window. The domain [today, today+45d] clamp still bounds the result.
    const [from, to] = sp.from <= sp.to ? [sp.from, sp.to] : [sp.to, sp.from];
    return { range: { from, to }, label: "range" };
  }
  if (sp.range === "weekend") {
    return { range: weekendRange(today), label: "weekend" };
  }
  return { range: { from: today, to: today }, label: "today" };
}

/** The relative path (with the active filter) the claim action returns to on error. */
function backHref(label: RangeLabel, sp: Search): string {
  if (label === "weekend") return "/crew/open?range=weekend";
  if (label === "range" && sp.from && sp.to) {
    return `/crew/open?from=${encodeURIComponent(sp.from)}&to=${encodeURIComponent(sp.to)}`;
  }
  return "/crew/open";
}

/** The upcoming Sat–Sun (vessel-local). On Sunday that's today; on Saturday, today+tomorrow. */
function weekendRange(today: string): DateRange {
  const dow = new Date(today + "T00:00:00Z").getUTCDay(); // 0 Sun … 6 Sat
  const satOffset = dow === 0 ? 0 : 6 - dow;
  return {
    from: addDays(today, satOffset),
    to: dow === 0 ? today : addDays(today, satOffset + 1),
  };
}

function fmtDate(iso: string): string {
  // Parse + format in UTC so the stored vessel-local date shows verbatim (DEC-032).
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Approximate the end of commitment to the nearest hour, "6pm" — the calm "back ~6". */
function approxBack(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const hr = (m >= 30 ? h + 1 : h) % 24;
  const period = hr < 12 ? "am" : "pm";
  const h12 = hr % 12 === 0 ? 12 : hr % 12;
  return `${h12}${period}`;
}
