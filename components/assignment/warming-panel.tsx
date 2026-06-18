import Link from "next/link";

/**
 * The warming view (SPEC §2.4, #55, DEC-027 §3) — shifts trending toward risk,
 * opened DELIBERATELY from the cockpit (a link, not a toggle — no client JS).
 * Never on the At-Risk board, never pings: this is the weather, not the alarm.
 * Empty when open is the calm answer, said plainly.
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
  /** True when this row IS the shift the cockpit is showing. */
  isCurrent: boolean;
}

export function WarmingPanel({
  rows,
  open,
  basePath,
}: {
  rows: WarmingRowVM[];
  open: boolean;
  /** The cockpit path the open/close links return to. */
  basePath: string;
}) {
  if (!open) {
    return (
      <Link href={`${basePath}?warming=1`} className="text-xs font-semibold text-accent">
        Trending at-risk →
      </Link>
    );
  }
  return (
    <section className="flex flex-col gap-2 rounded-card border border-line bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">Trending at-risk</h2>
        </div>
        <Link href={basePath} className="text-xs font-semibold text-accent">
          Hide
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing trending. The asks that are out are being answered.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line/60">
          {rows.map((r) => (
            <li
              key={r.shiftId}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
            >
              <span className="text-sm text-ink">
                {r.isCurrent ? (
                  <b>This shift</b>
                ) : (
                  <Link
                    href={`/admin/shift/${encodeURIComponent(r.shiftId)}?warming=1`}
                    className="font-semibold text-accent"
                  >
                    {r.vesselName} · {r.dateLabel} ↗
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
