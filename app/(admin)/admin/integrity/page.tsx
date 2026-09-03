import { checkIntegrity } from "@core/admin/integrity.js";
import { buildIntegrityView, type IntegrityView } from "@core/admin/integrity-view.js";
import { AppLink } from "../../../../components/ui/app-link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { logSwallowed } from "../../../lib/swallowed";

/**
 * /admin/integrity (#501) — the detective control the no-FK schema is predicated on.
 *
 * DEC-131 ratified the existing graph as-built: almost no foreign keys, and no
 * retrofit. That bet is only sound if something periodically asserts the spine is
 * intact on REAL data — and until this page, `checkIntegrity` ran only in the
 * contract suite against synthetic fixtures. The exposure is the writes that skip
 * the service layer (backfills, `db/reset-pilot.ts`, migrations, manual psql):
 * exactly the paths that can orphan a row, and exactly the ones no test covers.
 *
 * Admin-gated on purpose. The check used to run on `/api/health` and was pulled
 * because ~a dozen full-table `listAll*` reads on an anonymous endpoint is a
 * compute-amplification vector. Auth answers that; it does NOT make the scan cheap,
 * so the page is idle until you ask for it (`?run=1`) rather than scanning because
 * someone brushed the hub link. Zero client JS — the trigger is a plain GET link.
 */

export const dynamic = "force-dynamic";

type Search = { run?: string };

export default async function AdminIntegrity({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin")
    return <AdminSignedOut subject={subject} />;

  const requested = sp.run === "1";

  let view: IntegrityView | null = null;
  let failed = false;
  if (requested) {
    try {
      view = buildIntegrityView(await checkIntegrity(getRepo()));
    } catch (e) {
      // The diagnostic screen itself. `failed` renders "couldn't run" with no
      // reason, which is a poor showing for the page whose job is finding faults.
      logSwallowed("admin/integrity", e, "the integrity check did not run");
      failed = true;
    }
  }

  return (
    <Shell width="3xl">
      <h1 className="text-xl font-semibold text-ink">Referential integrity</h1>

      <p className="text-sm text-muted">
        Walks the structural spine and reports every reference pointing at a row
        that isn’t there. The database enforces almost none of this itself
        (DEC-131), so this check is how orphans from a backfill, a migration, or a
        hand-run query get found. It reads every table — run it when you want it,
        not on a schedule.
      </p>

      {failed && (
        <Notice tone="bad">
          Couldn’t reach the database to run the check — nothing was scanned. Try
          again in a moment.
        </Notice>
      )}

      {!requested && !failed && (
        <Notice>Not run yet. Nothing has been scanned on this page load.</Notice>
      )}

      {view && <Result view={view} />}

      <div>
        {/* `prefetch={false}` is load-bearing, not hygiene: this route is
            force-dynamic, so a prefetch on hover/viewport would fetch its RSC
            payload — running the twelve-table scan without anyone clicking, which
            is the exact thing the idle state exists to prevent. */}
        <AppLink
          href="/admin/integrity?run=1"
          prefetch={false}
          className="inline-flex rounded-card border border-accent bg-card px-4 py-3 font-semibold text-accent shadow-sm"
        >
          {requested ? "Run again →" : "Run check →"}
        </AppLink>
      </div>
    </Shell>
  );
}

/** The verdict, the violations, and the proof it actually walked the tables. */
function Result({ view }: { view: IntegrityView }) {
  return (
    <>
      {view.ok ? (
        <Notice tone="ok">
          No dangling references. Every reference in the spine resolves to a live
          row — {view.scannedTotal.toLocaleString()} rows scanned.
        </Notice>
      ) : (
        <Notice tone="bad">
          {view.total.toLocaleString()} dangling{" "}
          {view.total === 1 ? "reference" : "references"} across {view.groups.length}{" "}
          {view.groups.length === 1 ? "entity" : "entities"} —{" "}
          {view.scannedTotal.toLocaleString()} rows scanned.
        </Notice>
      )}

      {view.groups.map((group) => (
        <section key={group.entity} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">
            {group.entity} — {group.count.toLocaleString()}{" "}
            {group.count === 1 ? "violation" : "violations"}
          </h2>
          {/* Ids are long and unbreakable; let the table scroll rather than
              blowing out the page width on a phone. */}
          <div className="overflow-x-auto rounded-card border border-line bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase text-faint">
                <tr>
                  <th className="px-3 py-2 font-medium">Id</th>
                  <th className="px-3 py-2 font-medium">Reference</th>
                  <th className="px-3 py-2 font-medium">Missing id</th>
                </tr>
              </thead>
              <tbody>
                {group.violations.map((v) => (
                  <tr key={`${v.id}:${v.ref}:${v.missingId}`} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink">
                      {v.id}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">{v.ref}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-bad">
                      {v.missingId}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {/* Always rendered, clean or not: "no violations" and "it didn't run" look
          identical without these numbers. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink">Scanned</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-card border border-line bg-card px-4 py-3 text-sm sm:grid-cols-3">
          {view.scanned.map((s) => (
            <div key={s.entity} className="flex items-baseline justify-between gap-2">
              <dt className="text-muted">{s.entity}</dt>
              <dd className="font-mono text-xs text-ink">{s.rows.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
