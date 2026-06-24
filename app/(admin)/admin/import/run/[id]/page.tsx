import Link from "next/link";
import { asId } from "@core/domain/ids.js";
import type { ImportRunItemKind } from "@core/import/import-audit.js";
import { Notice } from "../../../../../../components/ui/notice";
import { Shell } from "../../../../../../components/ui/shell";
import { readSubject } from "../../../../../lib/auth";
import { fmt12, fmtRunWhen, IMPORT_SOURCE_LABEL } from "../../../../../lib/format";
import { getRepo } from "../../../../../lib/repo";

/**
 * Import-run detail (#128, DEC-056) — what one Xola import actually did. The
 * surface a manual pull lands on AND where a cron run is reviewed: counts,
 * the identity behind them (which reservations by name, which shifts), and the
 * join diagnostics that used to live only in the logs — unknown boats (the
 * actionable alert), window-truncated rows, stranded seats, per-day assignments.
 * Reads server-persisted data (no params) — sidesteps DEC-026's codes-only rule.
 */

export const dynamic = "force-dynamic";

export default async function ImportRunView({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <SignedOut />;

  const { id } = await params;
  const repo = getRepo();
  let data: Awaited<ReturnType<typeof repo.getImportRun>>;
  let vesselName: Map<string, string>;
  try {
    data = await repo.getImportRun(asId<"ImportRunId">(id));
    const vessels = await repo.listVessels();
    vesselName = new Map(vessels.map((v) => [String(v.id), v.name]));
  } catch {
    return (
      <Shell width="2xl">
        <Notice>Can’t reach the import history right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell width="2xl">
        <Notice>That import run wasn’t found.</Notice>
        <Link href="/admin/import" className="text-sm font-semibold text-accent">
          ← Import
        </Link>
      </Shell>
    );
  }

  const { run, items } = data;
  const s = run.summary;
  const labels = (k: ImportRunItemKind) =>
    items.filter((i) => i.kind === k).map((i) => i.label ?? i.refId);

  return (
    <Shell width="2xl">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">Import run</h1>
        <p className="text-sm text-muted">
          {IMPORT_SOURCE_LABEL[run.source] ?? run.source} · {fmtRunWhen(run.ranAt)} · window{" "}
          {fmtDate(run.window.start)} – {fmtDate(run.window.end)}
        </p>
      </header>

      {/* The headline counts. */}
      <div className="rounded-card border border-line bg-card px-4 py-3 text-sm text-ink">
        Pulled <b>{s.ordersFetched}</b> order{plural(s.ordersFetched)} ·{" "}
        <b>{s.reservationsAdded}</b> new, <b>{s.reservationsUpdated}</b> updated,{" "}
        <b>{s.reservationsNewlyCancelled}</b> newly cancelled · <b>{s.eventsCreated}</b>{" "}
        new event{plural(s.eventsCreated)} · <b>{s.shiftsCreated}</b> shift
        {plural(s.shiftsCreated)} formed
        {s.shiftsCancelled > 0 && (
          <>
            , <b>{s.shiftsCancelled}</b> cancelled
          </>
        )}
        .
      </div>

      {/* Actionable alerts — only when they fired. */}
      {s.unmappedResources.length > 0 && (
        <Notice tone="warn">
          <b>
            {s.unmappedResources.length} unknown boat
            {plural(s.unmappedResources.length)}
          </b>{" "}
          in this pull — a new or renamed Xola resource your dev must add to{" "}
          <code>resource-map.ts</code>:{" "}
          {s.unmappedResources.map((r) => r.reason).join("; ")}.
        </Notice>
      )}
      {s.seatsStranded > 0 && (
        <Notice tone="warn">
          <b>{s.seatsStranded} occupied seat{plural(s.seatsStranded)}</b> left in place
          after a manning change — resolve by hand (pruning would strand committed
          crew).
        </Notice>
      )}
      {(s.mapSkipped > 0 || s.skipped.length > 0) && (
        <Notice>
          {s.skipped.length + s.mapSkipped} row
          {plural(s.skipped.length + s.mapSkipped)} skipped (boat-less or outside the
          pulled window)
          {s.skipped.length > 0 && <>: {s.skipped.map((r) => r.reason).join("; ")}</>}.
        </Notice>
      )}
      {s.warnings.map((w, i) => (
        <Notice key={i}>{w}</Notice>
      ))}

      {/* Identity behind the counts. */}
      <ItemList title="Reservations added" labels={labels("reservation_added")} />
      <ItemList title="Reservations updated" labels={labels("reservation_updated")} />
      <ItemList
        title="Reservations newly cancelled"
        labels={labels("reservation_cancelled")}
      />
      <ItemList title="Shifts formed" labels={labels("shift_created")} mono />
      <ItemList title="Shifts cancelled" labels={labels("shift_cancelled")} mono />

      {/* The per-day boat→times review surface. */}
      {s.assignments.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">Assignments by day</h2>
          {s.assignments.map((day) => (
            <div
              key={day.date}
              className="rounded-card border border-line bg-card px-4 py-2 text-sm"
            >
              <div className="font-semibold text-ink">{fmtDate(day.date)}</div>
              {day.boats.length === 0 ? (
                <div className="text-xs text-muted">no boats</div>
              ) : (
                day.boats.map((b) => (
                  <div key={String(b.vesselId)} className="text-xs text-muted">
                    {vesselName.get(String(b.vesselId)) ?? String(b.vesselId)} ·{" "}
                    {b.times.map(fmt12).join("  ")}
                  </div>
                ))
              )}
            </div>
          ))}
        </section>
      )}

      <Link href="/admin/import" className="text-sm font-semibold text-accent">
        ← Import
      </Link>
    </Shell>
  );
}

function ItemList({
  title,
  labels,
  mono,
}: {
  title: string;
  labels: string[];
  mono?: boolean;
}) {
  if (labels.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-sm font-semibold text-ink">
        {title} <span className="text-xs font-normal text-muted">({labels.length})</span>
      </h2>
      <ul className={`flex flex-col gap-0.5 text-sm text-muted ${mono ? "font-mono text-xs" : ""}`}>
        {labels.map((l, i) => (
          <li key={`${l}-${i}`}>{l}</li>
        ))}
      </ul>
    </section>
  );
}

const plural = (n: number) => (n === 1 ? "" : "s");

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function SignedOut() {
  return (
    <Shell width="2xl">
      <h1 className="text-lg font-semibold text-ink">Muster · Import run</h1>
      <Notice>
        You’re signed out. Tap an operator magic link to get in — this surface is
        Spink’s.
      </Notice>
    </Shell>
  );
}
