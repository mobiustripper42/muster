import type { ReactNode } from "react";

/**
 * A day's heading on the admin lists (All Shifts, Purchases): the day on the left, an `aside` on the
 * right (a shift count there, an amount still owed here). An `h2`, so the page's `h1` stays the only
 * one above it.
 */
export function DayHeading({ label, aside }: { label: string; aside?: ReactNode }) {
  return (
    <h2 className="flex items-baseline justify-between gap-3 border-b border-line pb-1">
      <span className="text-sm font-semibold text-ink">{label}</span>
      {aside !== undefined && aside !== null && <span className="text-xs text-muted">{aside}</span>}
    </h2>
  );
}

/**
 * The list under the filters: a caption line, then the day sections. Day sections (gap-5) carry the
 * rhythm between them, so the caption hugs them rather than floating (`@ui-reviewer`).
 */
export function DayList({ caption, children }: { caption: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">{caption}</p>
      <div className="flex flex-col gap-5">{children}</div>
    </div>
  );
}

/** One day: its heading, then its cards in a tight column. */
export function DaySection({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <DayHeading label={label} aside={aside} />
      {children}
    </section>
  );
}
