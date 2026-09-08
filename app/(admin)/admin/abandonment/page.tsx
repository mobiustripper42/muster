import { abandonedCheckouts, summarizeAbandonment } from "@core/reservations/abandonment.js";
import { HOLD_MINUTES } from "@core/reservations/pending.js";
import { formatClock, formatShortDay } from "@core/reservations/availability-screen.js";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { logSwallowed } from "../../../lib/swallowed";

/**
 * /admin/abandonment (14.8, SPEC §2.8.8) — every checkout that claimed a boat and walked away.
 *
 * **This screen is why there is no reaper.** §2.8.8 chose to build the monitor before the
 * destructive tool: an abandoned checkout is the only evidence that says whether the payment
 * window is the right length, and writing the delete first would have destroyed the data that
 * says whether the delete was ever needed. Nothing removes these rows, so this is the whole
 * history, and it is meant to be.
 *
 * **It ranks nothing and accuses nobody.** A pending reservation is creatable by anyone who can
 * reach the checkout, so these rows carry scripted abuse alongside real abandonment — and no field
 * separates the two. "Never reached the provider" is a script *or* a provider outage *or* a
 * dropped connection. The table shows what was stored; whoever reads a season of it will see
 * patterns before anybody can name them, and categories can be added then.
 *
 * **Desktop only, operator's call** — a rare screen, no mobile layout. If that changes, the table
 * is the part that needs the work.
 *
 * Unlike `/admin/integrity` this runs on load rather than behind a `?run=1` link. That page reads
 * every table in the schema; this reads one, and it is small precisely because nothing reaps it.
 */

export const dynamic = "force-dynamic";

export default async function AdminAbandonment() {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  // One instant for the page: it decides which rows have lapsed, and a second `new Date()` further
  // down could disagree with the first by however long the read took (the issue #713 rule).
  const asOf = new Date().toISOString();

  let rows: ReturnType<typeof abandonedCheckouts> | null = null;
  let vesselNames = new Map<string, string>();
  try {
    const repo = getRepo();
    const [reservations, vessels] = await Promise.all([repo.listAllReservations(), repo.listVessels()]);
    rows = abandonedCheckouts(reservations, asOf);
    vesselNames = new Map(vessels.map((v) => [String(v.id), v.name]));
  } catch (e) {
    logSwallowed("admin/abandonment", e, "the abandonment list did not load");
  }

  if (!rows) {
    return (
      <Shell width="3xl">
        <h1 className="text-xl font-semibold text-ink">Abandoned checkouts</h1>
        <Notice tone="bad">
          Couldn’t reach the database — nothing was read. Try again in a moment.
        </Notice>
      </Shell>
    );
  }

  const summary = summarizeAbandonment(rows, HOLD_MINUTES);

  return (
    <Shell width="3xl">
      <h1 className="text-xl font-semibold text-ink">Abandoned checkouts</h1>

      <p className="text-sm text-muted">
        Every checkout that claimed a boat and never paid for it. Nothing deletes these — they are
        the only record of how much boat time is being held by people who don’t buy, which is the
        one thing that says whether the payment window is the right length.
      </p>

      {summary.total === 0 ? (
        <Notice tone="ok">
          No abandoned checkouts. Every checkout that claimed a boat either paid for it or is still
          inside its {summary.windowMinutes}-minute window.
        </Notice>
      ) : (
        <>
          <section className="grid grid-cols-3 gap-4">
            <Stat label="Walked away" value={summary.total.toLocaleString()} />
            <Stat
              label="Boat time held"
              value={`${summary.hullHoursWithheld.toLocaleString()} hr`}
              note={`${summary.total.toLocaleString()} × ${summary.windowMinutes} min`}
            />
            <Stat
              label="Reached the card form"
              value={`${summary.reachedProvider.toLocaleString()} of ${summary.total.toLocaleString()}`}
              note="the rest never got that far"
            />
          </section>

          {/* The caveat belongs here, once, rather than on every row: the window is not recorded
              per row, so this arithmetic uses whatever is set today. `SPEC.md:2116` accepts that
              and says the honest fix is noting when the knob moved — which is what this sentence
              is asking the reader to weigh it against. */}
          <p className="text-xs text-muted">
            Boat time assumes the current {summary.windowMinutes}-minute payment window
            (<code className="font-mono">CHECKOUT_HOLD_MINUTES</code>) for every row, including rows
            that lapsed while it was set to something else. If you change it, note when.
          </p>

          {/* Above the table, not below it. Nothing reaps these rows, so this list is meant to
              grow to a season's worth — and a glossary under an arbitrarily long table is a
              glossary nobody reaches at the moment they need it (@ui-reviewer). */}
          <p className="text-xs text-muted">
            <strong className="text-ink">Card form</strong> counts payment attempts — a dash means
            the checkout never reached the payment provider, which is a script, an outage or a
            dropped connection, and nothing here can tell you which.{" "}
            <strong className="text-ink">Session</strong> groups one browser’s repeat attempts; it
            is a hash, not the cookie itself.
          </p>

          <div className="overflow-x-auto rounded-card border border-line bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Departure</th>
                  <th scope="col" className="px-3 py-2 font-medium">Boat</th>
                  <th scope="col" className="px-3 py-2 font-medium">Guests</th>
                  <th scope="col" className="px-3 py-2 font-medium">Started</th>
                  <th scope="col" className="px-3 py-2 font-medium">Card form</th>
                  <th scope="col" className="px-3 py-2 font-medium">Session</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={String(r.id)} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-ink">
                      {formatShortDay(r.date)} · {formatClock(r.time)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">
                      {vesselNames.get(String(r.vesselId)) ?? String(r.vesselId)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">{r.partySize}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">
                      {/* Same 12-hour convention as Departure two columns left — reading one row
                          should not mean switching time formats mid-row. The UTC marker stays:
                          this is an instant, where the departure is a vessel-local clock time,
                          and dropping it would quietly imply they are the same kind of thing. */}
                      {formatShortDay(r.reservedAt.slice(0, 10))} ·{" "}
                      {formatClock(r.reservedAt.slice(11, 16))} UTC
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">
                      {/* The count, not a verdict. Two attempts is a customer who tried twice;
                          zero is "never reached the provider", which is three different things. */}
                      {r.paymentIntentCount === 0 ? "—" : `${r.paymentIntentCount}×`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-faint">
                      {r.session ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </>
      )}
    </Shell>
  );
}

/** One header number. `note` carries the arithmetic, so the figure above it needs no explaining. */
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-card border border-line bg-card px-4 py-3">
      <div className="text-xs uppercase text-faint">{label}</div>
      <div className="text-lg font-semibold text-ink">{value}</div>
      {note && <div className="text-xs text-faint">{note}</div>}
    </div>
  );
}
