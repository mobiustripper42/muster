import Link from "next/link";
import { Shell } from "../../../components/ui/shell";

/**
 * Admin hub (Spink) — nav to every reachable surface (#100 Part B). The At-Risk
 * board is ranked FIRST and heavier: it's the one surface that legitimately
 * summons (push). The rest — Outbox, Import, and the deliberate-PULL All-shifts
 * view — are plainer links below it, and All-shifts carries NO count badge (a
 * badge would turn a pull surface into ambient monitor-bait — DEC-042, BRAND).
 * The per-shift cockpit is reached from the boards, not listed here.
 */
export default function AdminHome() {
  return (
    <Shell width="3xl">
      <h1 className="text-xl font-semibold text-ink">Admin</h1>

      {/* Primary / push: the board that summons you. */}
      <Link
        href="/admin/at-risk"
        className="flex flex-col gap-0.5 rounded-card border border-accent bg-card px-4 py-4 shadow-sm"
      >
        <span className="font-semibold text-accent">At-Risk board →</span>
        <span className="text-sm text-muted">
          The trips the automation couldn’t close. Empty is good.
        </span>
      </Link>

      {/* Secondary: the surfaces you reach for when you want them. */}
      <Link
        href="/admin/outbox"
        className="rounded-card border border-line bg-card px-4 py-3 font-semibold text-accent shadow-sm"
      >
        Outbox — asks waiting on your text →
      </Link>
      <Link
        href="/admin/import"
        className="rounded-card border border-line bg-card px-4 py-3 font-semibold text-accent shadow-sm"
      >
        Import — load this week’s Xola reservations →
      </Link>
      <Link
        href="/admin/shifts"
        className="rounded-card border border-line bg-card px-4 py-3 font-semibold text-accent shadow-sm"
      >
        All shifts — everything on the books, for reference →
      </Link>

      <p className="text-sm text-muted">
        Roster, event admin, and shift builder land here in later phases.
      </p>
    </Shell>
  );
}
