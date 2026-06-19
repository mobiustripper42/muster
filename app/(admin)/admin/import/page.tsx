import Link from "next/link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { readSubject } from "../../../lib/auth";
import { pullFromXola, runImport } from "./actions";

/**
 * Import surface (SPEC §2.2, #73, 5.4a / DEC-037) — the operator's path to get
 * real Xola reservations onto the board. Upload the Reservations .xlsx →
 * import + form shifts → the board is live. Single-step (no pre-commit preview):
 * import is idempotent and unmapped rows are skipped, never mis-imported, so a
 * wrong result is fixed by re-uploading. Admin-gated; feedback rides redirect
 * params (codes/counts only, DEC-026) — the action maps them to copy here.
 */
export const dynamic = "force-dynamic";

const ERR_COPY: Record<string, string> = {
  no_file: "Choose a Xola .xlsx file first.",
  too_big: "That file is over the 5 MB limit — is it the right export?",
  bad_type: "That doesn’t look like an .xlsx. Export the Reservations report from Xola.",
  parse_error:
    "Couldn’t read that workbook — it needs a sheet named “Reservations”. Nothing was imported.",
  unavailable: "Couldn’t reach the schedule — nothing was imported. Try again.",
  x_not_configured:
    "Xola isn’t configured on this server (XOLA_API_KEY / XOLA_SELLER_ID unset) — nothing was pulled.",
  x_unavailable: "Couldn’t reach Xola — nothing was pulled. Try again in a moment.",
};

type Search = {
  ok?: string;
  xpull?: string;
  fetched?: string;
  added?: string;
  updated?: string;
  cancelled?: string;
  events?: string;
  shifts?: string;
  shiftsCancelled?: string;
  skipped?: string;
  warn?: string;
  err?: string;
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

  const err = sp.err
    ? (ERR_COPY[sp.err] ?? null)
    : sp.xerr
      ? (ERR_COPY[sp.xerr] ?? null)
      : null;
  const n = (v?: string) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const skipped = n(sp.skipped);
  const cancelled = n(sp.shiftsCancelled);
  const plural = (k: number) => (k === 1 ? "" : "s");

  return (
    <Shell width="2xl">
      <header>
        <h1 className="text-xl font-semibold text-ink">Import reservations</h1>
        <p className="text-sm text-muted">
          Upload the Xola <strong>Reservations</strong> export (.xlsx). It fills
          the board with upcoming trips and the crew seats they need.
        </p>
        <p className="mt-1 text-xs text-muted">
          In Xola: <strong>Reports → Reservations</strong>, date range{" "}
          <strong>Leading Year</strong>, export <code>.xlsx</code>. Re-importing is
          safe — it updates in place, never duplicates.
        </p>
      </header>

      {err && <Notice tone="bad">{err}</Notice>}

      {sp.ok && (
        <Notice tone={skipped > 0 ? "warn" : "ok"}>
          ✓ Imported {n(sp.added)} new and {n(sp.updated)} updated reservation
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
              (unmapped product or bad date) — check with your dev.
            </>
          )}{" "}
          <Link href="/admin/at-risk" className="font-semibold text-accent">
            See the board →
          </Link>
        </Notice>
      )}

      {sp.xpull && (
        <Notice tone={skipped > 0 ? "warn" : "ok"}>
          ✓ Pulled {n(sp.fetched)} order{plural(n(sp.fetched))} from Xola —{" "}
          {n(sp.added)} new and {n(sp.updated)} updated reservation
          {plural(n(sp.added) + n(sp.updated))} · {n(sp.events)} new event
          {plural(n(sp.events))} · {n(sp.shifts)} shift{plural(n(sp.shifts))} formed
          {cancelled > 0 && (
            <>
              {" "}
              · {cancelled} shift{plural(cancelled)} cancelled
            </>
          )}
          .
          {n(sp.fetched) === 0 && (
            <> No trips in the next week’s window — nothing to import (normal if the calendar’s clear).</>
          )}
          {skipped > 0 && (
            <>
              {" "}
              <strong>
                {skipped} row{plural(skipped)} skipped
              </strong>{" "}
              (unmapped product or bad date) — check with your dev.
            </>
          )}{" "}
          <Link href="/admin/at-risk" className="font-semibold text-accent">
            See the board →
          </Link>
        </Notice>
      )}

      {/* No encType/method here: React sets them automatically for a function
          action (it posts multipart when there's a file) and ERRORS if you also
          specify them. */}
      <form
        action={runImport}
        className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-4"
      >
        <label className="text-sm font-semibold text-ink" htmlFor="file">
          Xola Reservations .xlsx
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          className="text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
        />
        <button
          type="submit"
          className="mt-1 min-h-11 rounded-card bg-accent px-4 font-semibold text-white shadow-sm"
        >
          Upload &amp; import
        </button>
        <p className="text-xs text-muted">
          Re-importing the same week is safe — it updates in place, never
          duplicates.
        </p>
      </form>

      <form
        action={pullFromXola}
        className="flex flex-col gap-2 rounded-card border border-line bg-card px-4 py-4"
      >
        <span className="text-sm font-semibold text-ink">Or pull directly from Xola</span>
        <p className="text-xs text-muted">
          Imports the next week of trips straight from the live Xola account — no
          file needed. Runs automatically every hour too; this is the “do it now”
          button. Same idempotent import, so it’s safe to press anytime.
        </p>
        <button
          type="submit"
          className="mt-1 min-h-11 rounded-card border border-accent px-4 font-semibold text-accent"
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
