import { AppLink } from "../../../../components/ui/app-link";
import { CrewHeader } from "../../../../components/crew/crew-header";
import { GetFormSubmit } from "../../../../components/ui/get-form-submit";
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
import { CREW_UNAVAILABLE, logSwallowed } from "../../../lib/swallowed";
import { fmt12 } from "../../../lib/format";
import { vesselHueClass } from "../../../lib/vessel-hue";
import { claimSeat } from "./actions";

/**
 * /crew/open (SPEC §2.7.1, DEC-074) — the crew-facing PULL surface, the 4th crew
 * surface (a knowing exception to "three surfaces"). Lists the viewer's claimable
 * Open seats and lets them claim one (auto-lock, DEC-075). Inherits DEC-042's
 * anti-anxiety guardrails: [today, today+45d] clamp (owned by `claimableSeatsFor`),
 * NO auto-refresh / NO polling / NO live per-state counts (a bare row count for
 * orientation is fine), neutral ink (warm/bad tokens stay reserved for the At-Risk
 * board). The default filter is **7 Days** (#414 — not today, not just the weekend;
 * this is a pull surface, so crew browse a week ahead). Presets step out to 2 Weeks /
 * 30 Days, plus a from–to form defaulting to the next 30 days.
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
  } catch (e) {
    logSwallowed("crew/open", e, "the claimable-shift list did not build");
    return (
      <Shell>
        <CrewHeader title="Pick up a shift" back={{ href: "/crew", label: "My shifts" }} />
        <Notice>{CREW_UNAVAILABLE}</Notice>
      </Shell>
    );
  }

  const claimError = sp.claim_error ? CLAIM_ERROR_COPY[sp.claim_error] ?? null : null;

  return (
    <Shell>
      <CrewHeader title="Pick up a shift" back={{ href: "/crew", label: "My shifts" }} />
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">
          Open spots you’re cleared for. Claiming puts you on for the whole day.
        </p>
      </header>

      <Filters label={label} today={today} sp={sp} />

      {claimError && <Notice>{claimError}</Notice>}

      {rows.length === 0 ? (
        <Notice>Nothing open in this window. Check back, or widen the dates above.</Notice>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-xs uppercase tracking-wide text-muted">
            {rows.length} open
          </p>
          {/* Day-grouped (#313): the flat list read as one dense stack. Same
              pattern as the admin board — a full-weekday header per day, rows
              within a day kept in the core's time order (date → departure). */}
          {groupByDay(rows).map((day) => (
            <section key={day.date} className="flex flex-col gap-2">
              <h2 className="flex items-baseline justify-between border-b border-line pb-1">
                <span className="text-sm font-semibold text-ink">
                  {fmtDayHeader(day.date)}
                </span>
                <span className="text-xs text-faint">
                  {day.rows.length} open
                </span>
              </h2>
              {day.rows.map((r) => (
                <ClaimRow key={r.seatId} row={r} back={back} />
              ))}
            </section>
          ))}
        </div>
      )}

      <VersionTag />
    </Shell>
  );
}

/** 7 Days / 2 Weeks / 30 Days presets (links) + a from–to GET form. Active = filled. */
function Filters({
  label,
  today,
  sp,
}: {
  label: RangeLabel;
  today: string;
  sp: Search;
}) {
  // One app-wide filter style — matches the admin board's Filter (outline-active
  // pills, rounded-card container, rounded-lg date inputs on bg-bg). One deliberate
  // divergence: the crew controls keep min-h-[44px] touch targets (this is the
  // mobile-primary surface, DEC-085); admin is denser because it's desktop-first.
  const chip = (active: boolean) =>
    `pressable inline-flex min-h-[44px] items-center rounded-full border px-4 ${active ? "border-accent text-accent" : "border-line text-muted"}`;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <AppLink href="/crew/open" className={chip(label === "7d")}>
          7 Days
        </AppLink>
        <AppLink href="/crew/open?range=2w" className={chip(label === "2w")}>
          2 Weeks
        </AppLink>
        <AppLink href="/crew/open?range=30d" className={chip(label === "30d")}>
          30 Days
        </AppLink>
      </div>
      {/* No-JS date range: a GET form submits ?from&to back to this page. Defaults
          to the next 30 days, so a bare "Show" gives a month. */}
      <form method="get" action="/crew/open" className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          From
          <input
            type="date"
            name="from"
            defaultValue={label === "range" ? sp.from : today}
            min={today}
            className="min-h-[44px] rounded-lg border border-line bg-bg px-2 text-ink"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          To
          <input
            type="date"
            name="to"
            defaultValue={label === "range" ? sp.to : addDays(today, 30)}
            max={addDays(today, 45)}
            className="min-h-[44px] rounded-lg border border-line bg-bg px-2 text-ink"
          />
        </label>
        <GetFormSubmit className="inline-flex min-h-[44px] items-center rounded-lg border border-line bg-bg px-3 font-semibold text-accent">
          Show
        </GetFormSubmit>
      </form>
    </div>
  );
}

/** Day-section header (#313): full weekday so a weekend reads at a glance, UTC-
 *  anchored so the stored vessel-local date shows verbatim (DEC-032). Mirrors the
 *  admin board's `fmtDayHeader`. */
function fmtDayHeader(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Group the already-sorted (date → departure) rows into chronological day
 *  buckets — order within a day is preserved, so a day reads in time order. Pure
 *  presentation; the core view already clamps + sorts (#313, admin-board pattern). */
function groupByDay(
  rows: ClaimableSeatView[],
): { date: string; rows: ClaimableSeatView[] }[] {
  const byDate = new Map<string, ClaimableSeatView[]>();
  for (const r of rows) {
    const bucket = byDate.get(r.date);
    if (bucket) bucket.push(r);
    else byDate.set(r.date, [r]);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, rows]) => ({ date, rows }));
}

/** One claimable seat: a <details> whose open state is the DEC-077 confirm sheet. */
function ClaimRow({ row, back }: { row: ClaimableSeatView; back: string }) {
  // The collapsed row's hero time — the first scheduled departure ("when it
  // leaves"). The full call→back window + trip list live in the confirm sheet.
  const departure = row.tripTimes[0] ? fmt12(row.tripTimes[0]) : null;
  const n = row.tripTimes.length;
  const tripCount = n > 0 ? `${n} trip${n === 1 ? "" : "s"}` : null;
  const facts = confirmFacts(row);
  return (
    <details className="group overflow-hidden rounded-card border border-line bg-card shadow-sm">
      <summary className="flex min-h-[44px] cursor-pointer items-start justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        {/* Left: day over vessel · role. The role lives here, so the confirm copy
            below doesn't repeat "as captain". */}
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold text-ink">{fmtDate(row.date)}</span>
          <span className="flex items-center gap-1.5 text-sm text-muted">
            {/* DEC-086 vessel identity dot — which boat, at a glance. aria-hidden;
                the vessel name is the accessible answer. */}
            <span
              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${vesselHueClass(row.vesselId, row.vesselHue)}`}
              aria-hidden
            />
            {row.vesselName} · {row.roleName}
          </span>
        </span>
        {/* Right: departure time (the scannable "when") with the trip count right
            under it — end time is left to the confirm sheet (too busy collapsed). */}
        <span className="flex shrink-0 items-center gap-3">
          <span className="flex flex-col items-end">
            <span className="font-mono text-sm font-semibold text-ink">
              {departure ?? "TBD"}
            </span>
            {tripCount && <span className="text-xs text-muted">{tripCount}</span>}
          </span>
          <span
            className="text-faint transition-transform group-open:rotate-90"
            aria-hidden
          >
            ›
          </span>
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
        <div className="flex flex-col gap-1 text-sm text-muted">
          <p>{confirmLead(row)}</p>
          {facts && (
            <p>
              <span className="font-semibold text-ink">Currently:</span> {facts}
            </p>
          )}
        </div>
        <form action={claimSeat}>
          <input type="hidden" name="seatId" value={row.seatId} />
          <input type="hidden" name="back" value={back} />
          <SubmitButton className="min-h-[44px] w-full rounded-card border border-accent bg-accent px-4 font-semibold text-white">
            Claim this shift
          </SubmitButton>
        </form>
      </div>
    </details>
  );
}

/** The DEC-077 confirm lead: whole-day scope. When no trips are scheduled yet,
 *  it carries that note itself (there's no facts line to hang it on). */
function confirmLead(r: ClaimableSeatView): string {
  // No "as {role}" — the role is right above in the row header (● vessel · role).
  const head = `Claim ${fmtDate(r.date)} on ${r.vesselName}? That’s the whole day — including any trips added or cancelled later.`;
  return hasTrips(r) ? head : `${head} No trips are scheduled yet.`;
}

/** The DEC-077 live facts — trip count/times · start · back — rendered after a
 *  "Currently:" label. Null when the shift has no scheduled trips yet.
 *
 *  `r.callTime` is the field name; **"start" is the word the crew get** — the same value the
 *  shift card labels "Shift Start" (DEC-158). Nobody outside the trade knows what a call time
 *  is, and this was the last crew-facing surface still using the internal term. */
function confirmFacts(r: ClaimableSeatView): string | null {
  if (!hasTrips(r)) return null;
  const n = r.tripTimes.length;
  return `${n} trip${n === 1 ? "" : "s"} (${joinTimes(r.tripTimes)}) · start ${fmt12(r.callTime!)} · back ~${backAt(r.shiftEndTime!)}`;
}

/** A shift has a renderable trip picture only if it has scheduled trips AND a
 *  derived call/back window (an event-less shift has neither). */
function hasTrips(r: ClaimableSeatView): boolean {
  return r.tripTimes.length > 0 && !!r.callTime && !!r.shiftEndTime;
}

/** "1:30 PM", "1:30 PM & 3:30 PM", "1:30 PM, 3:30 PM & 7:30 PM". Keeps each
 *  time's period — collapsing to a trailing AM/PM would misread a mixed list
 *  (an 11 AM trip before a 1 PM one). */
function joinTimes(times: string[]): string {
  const t = times.map(fmt12);
  if (t.length <= 1) return t.join("");
  return `${t.slice(0, -1).join(", ")} & ${t[t.length - 1]}`;
}

/** approxBack, cased + spaced for prose: "10pm" → "10 PM". */
function backAt(hhmm: string): string {
  return approxBack(hhmm).replace(/(am|pm)$/i, " $1").toUpperCase();
}

type RangeLabel = "7d" | "2w" | "30d" | "range";

/** Resolve the active date range from search params. Default = next 7 days (#414):
 *  a pull surface — crew browse a week ahead, not just today, not just the weekend. */
function resolveRange(sp: Search, today: string): { range: DateRange; label: RangeLabel } {
  if (sp.from && sp.to) {
    // Tolerate a backwards range (from > to) — swap rather than render a confusing
    // empty window. The domain [today, today+45d] clamp still bounds the result.
    const [from, to] = sp.from <= sp.to ? [sp.from, sp.to] : [sp.to, sp.from];
    return { range: { from, to }, label: "range" };
  }
  if (sp.range === "2w") return { range: { from: today, to: addDays(today, 14) }, label: "2w" };
  if (sp.range === "30d") return { range: { from: today, to: addDays(today, 30) }, label: "30d" };
  return { range: { from: today, to: addDays(today, 7) }, label: "7d" };
}

/** The relative path (with the active filter) the claim action returns to on error. */
function backHref(label: RangeLabel, sp: Search): string {
  if (label === "2w") return "/crew/open?range=2w";
  if (label === "30d") return "/crew/open?range=30d";
  if (label === "range" && sp.from && sp.to) {
    return `/crew/open?from=${encodeURIComponent(sp.from)}&to=${encodeURIComponent(sp.to)}`;
  }
  return "/crew/open";
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
