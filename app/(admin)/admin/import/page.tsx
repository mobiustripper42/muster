import Link from "next/link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { readSubject } from "../../../lib/auth";
import { pullFromXola } from "./actions";

/**
 * Import surface (DEC-043) — the operator's path to get live Xola trips onto the
 * board. The `/events` ⨝ `/orders` pull runs hourly on its own; this is the "do it
 * now" button. Admin-gated; feedback rides redirect params (codes/counts only,
 * DEC-026). The xlsx upload is retired — the spreadsheet can't resolve a boat.
 */
export const dynamic = "force-dynamic";

const ERR_COPY: Record<string, string> = {
  x_not_configured:
    "Xola isn’t configured on this server (XOLA_API_KEY / XOLA_SELLER_ID unset) — nothing was pulled.",
  x_unavailable: "Couldn’t reach Xola — nothing was pulled. Try again in a moment.",
};

type Search = {
  xpull?: string;
  fetched?: string;
  added?: string;
  updated?: string;
  cancelled?: string;
  events?: string;
  shifts?: string;
  shiftsCancelled?: string;
  skipped?: string;
  unmapped?: string;
  xerr?: string;
};

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <SignedOut />;

  const err = sp.xerr ? (ERR_COPY[sp.xerr] ?? null) : null;
  const n = (v?: string) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const skipped = n(sp.skipped);
  const unmapped = n(sp.unmapped);
  const cancelled = n(sp.shiftsCancelled);
  const plural = (k: number) => (k === 1 ? "" : "s");

  return (
    <Shell width="2xl">
      <header>
        <h1 className="text-xl font-semibold text-ink">Pull from Xola</h1>
        <p className="text-sm text-muted">
          Imports the next week of trips straight from the live Xola account and
          fills the board with the crew seats they need. Runs automatically every
          hour — this is the “do it now” button. Safe to press anytime (it updates
          in place, never duplicates).
        </p>
      </header>

      {err && <Notice tone="bad">{err}</Notice>}

      {sp.xpull &&
        (n(sp.fetched) === 0 ? (
          <Notice tone="ok">
            ✓ Pulled from Xola — no trips in the window, so nothing to import
            (normal if the calendar’s clear).{" "}
            <Link href="/admin/at-risk" className="font-semibold text-accent">
              See the board →
            </Link>
          </Notice>
        ) : (
          <Notice tone={skipped > 0 || unmapped > 0 ? "warn" : "ok"}>
            ✓ Pulled {n(sp.fetched)} order{plural(n(sp.fetched))} — {n(sp.added)} new
            and {n(sp.updated)} updated reservation
            {plural(n(sp.added) + n(sp.updated))} · {n(sp.events)} new event
            {plural(n(sp.events))} · {n(sp.shifts)} shift{plural(n(sp.shifts))} formed
            {cancelled > 0 && (
              <>
                {" "}
                · {cancelled} shift{plural(cancelled)} cancelled
              </>
            )}
            .
            {skipped > 0 && (
              <>
                {" "}
                <strong>
                  {skipped} row{plural(skipped)} skipped
                </strong>{" "}
                (boat-less or cancelled trip) — check with your dev.
              </>
            )}
            {unmapped > 0 && (
              <>
                {" "}
                <strong>
                  {unmapped} unknown boat{plural(unmapped)}
                </strong>{" "}
                in the schedule — a new or renamed Xola resource your dev must map.
              </>
            )}{" "}
            <Link href="/admin/at-risk" className="font-semibold text-accent">
              See the board →
            </Link>
          </Notice>
        ))}

      <form
        action={pullFromXola}
        className="flex flex-col gap-2 rounded-card border border-line bg-card px-4 py-4"
      >
        <span className="text-sm font-semibold text-ink">Pull the latest schedule</span>
        <p className="text-xs text-muted">
          The live pull also runs every hour on its own; press this to import right
          now and watch the counts.
        </p>
        <button
          type="submit"
          className="mt-1 min-h-11 rounded-card bg-accent px-4 font-semibold text-white shadow-sm"
        >
          Pull from Xola now
        </button>
      </form>

      <Link href="/admin" className="text-sm font-semibold text-accent">
        ← Admin
      </Link>
    </Shell>
  );
}

function SignedOut() {
  return (
    <Shell width="2xl">
      <h1 className="text-lg font-semibold text-ink">Muster · Import</h1>
      <Notice>
        You’re signed out. Tap an operator magic link to get in — this surface is
        Spink’s.
      </Notice>
    </Shell>
  );
}
