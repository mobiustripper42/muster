import Link from "next/link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { readSubject } from "../../../lib/auth";
import { pullFromXola } from "./actions";
import { ClearFeedbackParams } from "./clear-feedback-params";

/**
 * Import surface (DEC-043) — the operator's path to get live Xola trips onto the
 * board. The `/events` ⨝ `/orders` pull runs hourly on its own; this is the "do it
 * now" button. Admin-gated. A failed pull rides a redirect param (codes only,
 * DEC-026); a SUCCESSFUL pull redirects to its audit detail (#128) — the full
 * breakdown of what changed. The xlsx upload is retired (can't resolve a boat).
 */
export const dynamic = "force-dynamic";

const ERR_COPY: Record<string, string> = {
  x_not_configured:
    "Xola isn’t configured on this server (XOLA_API_KEY / XOLA_SELLER_ID unset) — nothing was pulled.",
  x_auth:
    "Xola rejected the request — likely a bad API key, seller id, or missing permission. Check XOLA_API_KEY / XOLA_SELLER_ID. Nothing was pulled.",
  x_unavailable: "Couldn’t reach Xola — nothing was pulled. Try again in a moment.",
};

type Search = { xerr?: string; ximported?: string };

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <SignedOut />;

  const err = sp.xerr ? (ERR_COPY[sp.xerr] ?? null) : null;

  return (
    <Shell width="2xl">
      {/* Strip the one-shot feedback params after render (#121, DEC-055) — the
          code never lingers in the URL or re-renders on reload. */}
      <ClearFeedbackParams />
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

      {/* Import succeeded but its audit detail couldn't be saved (#128) — the
          import is the contract, so say so honestly instead of an error. */}
      {sp.ximported && (
        <Notice tone="warn">
          ✓ Imported — the board’s updated.{" "}
          <Link href="/admin/at-risk" className="font-semibold text-accent">
            See the board →
          </Link>{" "}
          (Couldn’t save this run’s audit detail this time; nothing else is wrong.)
        </Notice>
      )}

      <form
        action={pullFromXola}
        className="flex flex-col gap-2 rounded-card border border-line bg-card px-4 py-4"
      >
        <span className="text-sm font-semibold text-ink">Pull the latest schedule</span>
        <p className="text-xs text-muted">
          The live pull also runs every hour on its own; press this to import now —
          you’ll land on a full breakdown of what changed.
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
