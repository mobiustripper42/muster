import Link from "next/link";

/**
 * The warming view (SPEC §2.4, #55, DEC-027 §3) — shifts trending toward risk,
 * opened DELIBERATELY from the cockpit (a link, not a toggle — no client JS).
 * Never on the At-Risk board, never pings: this is the weather, not the alarm.
 * Empty when open is the calm answer, said plainly.
 *
 * Host-agnostic (DEC-085): every href is supplied by the cockpit body, which
 * knows its host — standalone rows link `/admin/shift/<id>`, pane rows link
 * `/admin/shifts?…&sel=<id>` so the operator never falls out of two-pane.
 */

export interface WarmingRowVM {
  shiftId: string;
  vesselName: string;
  dateLabel: string;
  /** "departs in 2d 4h" — warming rows always have a trip ahead. */
  toTrip: string;
  unfilledSeats: number;
  /** "67% answered" or null before any ask settles. */
  responseLabel: string | null;
  silent: number;
  /** Link to this row's cockpit (host-aware); null when this row IS the shift
   *  the cockpit is showing. */
  href: string | null;
}

export function WarmingPanel({
  rows,
  open,
  openHref,
  closeHref,
}: {
  rows: WarmingRowVM[];
  open: boolean;
  /** This cockpit with `warming=1` — the "Trending at-risk →" link. */
  openHref: string;
  /** This cockpit without the warming param — the "Hide" link. */
  closeHref: string;
}) {
  if (!open) {
    return (
      <Link
        href={openHref}
        className="inline-flex min-h-9 items-center self-start text-xs font-semibold text-accent"
      >
        Trending at-risk <span aria-hidden="true">&nbsp;→</span>
      </Link>
    );
  }
  return (
    <section className="flex flex-col gap-2 rounded-card border border-line bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          {/* Section kicker scale (9.8) — matches the seat-card kicker. */}
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-muted">
            Trending at-risk
          </h2>
        </div>
        <Link
          href={closeHref}
          className="inline-flex min-h-9 items-center px-1.5 text-xs font-semibold text-accent"
        >
          Hide
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing trending. All asks are being answered.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line/60">
          {rows.map((r) => (
            <li
              key={r.shiftId}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
            >
              <span className="text-sm text-ink">
                {r.href === null ? (
                  <b>This shift</b>
                ) : (
                  <Link
                    href={r.href}
                    className="inline-flex min-h-9 items-center font-semibold text-accent"
                  >
                    {r.vesselName} · {r.dateLabel}
                    <span aria-hidden="true">&nbsp;↗</span>
                  </Link>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 text-xs">
                <span className="font-mono text-ink">{r.toTrip}</span>
                <span className="text-muted">
                  {r.unfilledSeats} seat{r.unfilledSeats === 1 ? "" : "s"} unfilled
                </span>
                {r.responseLabel && <span className="text-muted">{r.responseLabel}</span>}
                {r.silent > 0 && (
                  <span className="font-semibold text-bad">
                    {r.silent} silent
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
