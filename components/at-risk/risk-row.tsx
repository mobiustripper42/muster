import Link from "next/link";
import { leanOn } from "../../app/(admin)/admin/at-risk/actions";

/**
 * One At-Risk board row (SPEC §2.5, #42) — enough to act without opening it:
 * what's missing, time to trip, the SYSTEM-TRIED trail, who's still available,
 * and the decision surface. Lean is live (#43); reschedule/cancel render
 * disabled — the cascades are parked with payments (P3 scoping, DEC-026) and a
 * live cancel without its cascade would be worse than an honest disabled one.
 * Server component; the per-person Lean buttons post a form, no client JS.
 */

export interface RiskRowVM {
  shiftId: string;
  vesselName: string;
  dateLabel: string;
  /** "1d 4h to trip" — null when no scheduled event anchors the shift. */
  toTrip: string | null;
  /** Inside 36h — the countdown turns red. */
  tight: boolean;
  /** Every scheduled departure, earliest first ("departs 1:00 PM"). A two-trip
   * day shows both; empty when no scheduled trip anchors the shift. */
  departs: string[];
  flag: { label: string; tone: "bad" | "warn" };
  regression: boolean;
  missing: { roleName: string; count: number }[];
  /** "Gus's MMC lapses before the trip" lines, one per lapsed assignee. */
  lapsed: string[];
  trail: {
    asked: number;
    declined: number;
    silent: number;
    pending: number;
    widened: boolean;
    nudgedNames: string[];
    exhausted: boolean;
  };
  available: { id: string; name: string }[];
}

const TONE = {
  bad: { rail: "bg-bad", pill: "bg-bad-bg text-bad border-bad-line" },
  warn: { rail: "bg-warn", pill: "bg-warn-bg text-warn border-warn-line" },
} as const;

function TrailLine({ trail }: { trail: RiskRowVM["trail"] }) {
  const segs: React.ReactNode[] = [];
  const push = (key: string, node: React.ReactNode) =>
    segs.push(
      <span key={key} className="whitespace-nowrap">
        {segs.length > 0 && <span className="mx-1.5 text-faint">·</span>}
        {node}
      </span>,
    );
  if (trail.asked) push("a", <>asked <b>{trail.asked}</b></>);
  if (trail.declined) push("d", <span className="text-muted">{trail.declined} declined</span>);
  if (trail.silent) push("s", <span className="font-medium text-bad">{trail.silent} silent</span>);
  if (trail.pending) push("p", <>{trail.pending} awaiting reply</>);
  if (trail.widened) push("w", <>pool widened</>);
  if (trail.nudgedNames.length)
    push("n", <span className="whitespace-normal">nudged {trail.nudgedNames.join(", ")}</span>);
  if (trail.exhausted) push("e", <span className="font-semibold">exhausted</span>);
  if (segs.length === 0) {
    push("z", <span className="text-muted">no one eligible to ask</span>);
  }
  return (
    <div className="flex flex-wrap items-baseline gap-y-1 border-t border-line pt-2 text-xs text-ink">
      <span className="mr-2 text-[10px] font-bold uppercase tracking-wider text-muted">
        System tried
      </span>
      {segs}
    </div>
  );
}

export function RiskRow({ row }: { row: RiskRowVM }) {
  const tone = TONE[row.flag.tone];
  return (
    <article className="flex overflow-hidden rounded-card border border-line bg-card shadow-sm">
      <div className={`w-1 shrink-0 ${tone.rail}`} aria-hidden />
      <div className="flex min-w-0 grow flex-col gap-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 flex-col gap-1">
            <span
              className={`self-start rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone.pill}`}
            >
              {row.flag.label}
            </span>
            <span className="text-ink">
              <b>{row.vesselName}</b> · {row.dateLabel}
            </span>
            {/* Departures live with the date (all trips, earliest first) — the
                "when's the trip" facts grouped, not split across the row. */}
            {row.departs.map((d, i) => (
              <span key={i} className="font-mono text-xs text-muted">
                {d}
              </span>
            ))}
          </div>
          <div className="flex flex-col items-end">
            <span
              className={`font-mono text-sm font-semibold ${row.tight ? "text-bad" : "text-ink"}`}
            >
              {row.toTrip ?? "no scheduled trip"}
            </span>
          </div>
        </div>

        {(row.missing.length > 0 || row.lapsed.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {row.missing.length > 0 && (
              <>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Missing
                </span>
                {row.missing.map((m) => (
                  <span
                    key={m.roleName}
                    className="rounded-full border border-line bg-bg px-2 py-0.5 text-xs font-medium text-ink"
                  >
                    {m.count} {m.roleName}
                  </span>
                ))}
              </>
            )}
            {row.lapsed.map((line) => (
              <span key={line} className="text-xs text-bad">
                ⊘ {line}
              </span>
            ))}
          </div>
        )}

        <TrailLine trail={row.trail} />

        {/* Hidden entirely on a no-gap row (credential lapse on a crewed boat):
            the problem there is the credential, not headcount — "nobody left in
            the pool" would be the wrong honesty. */}
        {(row.available.length > 0 || row.missing.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
            Still available
          </span>
          {row.available.length === 0 ? (
            <span className="text-xs text-muted">
              nobody left in the eligible pool — this is the reschedule / cancel
            </span>
          ) : (
            row.available.map((p) => (
              <form key={p.id} action={leanOn} className="inline-flex">
                <input type="hidden" name="shiftId" value={row.shiftId} />
                <input type="hidden" name="crewMemberId" value={p.id} />
                <button
                  type="submit"
                  className="rounded-full border border-line bg-card px-2.5 py-1 text-xs font-medium text-accent hover:border-accent"
                  title={`Direct nudge — “I need you on this”`}
                >
                  ↗ Nudge {p.name}
                </button>
              </form>
            ))
          )}
        </div>
        )}

        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <button
                disabled
                title="Disabled for now — customer-side cancellation cascades land with payments (parked, P3). Handle by phone."
                className="cursor-not-allowed rounded-full border border-line px-2.5 py-1 text-xs text-faint"
              >
                ↻ Reschedule
              </button>
              <button
                disabled
                title="Disabled for now — customer-side cancellation cascades land with payments (parked, P3). Handle by phone."
                className="cursor-not-allowed rounded-full border border-line px-2.5 py-1 text-xs text-faint"
              >
                ✕ Cancel…
              </button>
            </div>
            <Link
              href={`/admin/shift/${row.shiftId}`}
              className="text-xs font-semibold text-accent"
            >
              Assignment ↗
            </Link>
          </div>
          <span className="text-xs text-muted">
            Handle reschedule/cancel by phone for now.
          </span>
        </div>
      </div>
    </article>
  );
}
