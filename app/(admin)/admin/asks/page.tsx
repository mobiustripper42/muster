import {
  buildAuditTrail,
  type AuditTrailRow,
  type AuditKind,
  AUDIT_KIND_LABEL,
  AUDIT_KINDS,
} from "@core/admin/audit-trail.js";
import { asId } from "@core/domain/ids.js";
import { AppLink } from "../../../../components/ui/app-link";
import { GetFormSubmit } from "../../../../components/ui/get-form-submit";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { ADMIN_LOG_HINT, logSwallowed } from "../../../lib/swallowed";
import { fmtRunWhen } from "../../../lib/format";

/**
 * /admin/asks — the crew audit trail (#400, DEC-118). ONE list of every event
 * that happens to a crew member (asked, in, out, added, removed, bailed, …),
 * newest first, filterable by crew and by kind. `buildAuditTrail` is the source
 * of truth for what belongs. Calm/neutral — the kind is a word, not an alarm.
 */

export const dynamic = "force-dynamic";

type Search = { crew?: string; kind?: string };

const asKind = (v?: string): AuditKind | undefined =>
  v && (AUDIT_KINDS as readonly string[]).includes(v) ? (v as AuditKind) : undefined;

export default async function AdminAudit({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin")
    return <AdminSignedOut subject={subject} />;

  const kind = asKind(sp.kind);

  let rows: AuditTrailRow[];
  let crew: { id: string; name: string }[];
  try {
    const repo = getRepo();
    const [trail, members] = await Promise.all([
      buildAuditTrail(repo, {
        ...(sp.crew ? { crewMemberId: asId<"CrewMemberId">(sp.crew) } : {}),
        ...(kind ? { kind } : {}),
      }),
      repo.listCrewMembers(),
    ]);
    rows = trail;
    crew = members
      .map((m) => ({ id: String(m.id), name: m.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    logSwallowed("admin/asks", e, "the ask audit trail did not load");
    return (
      <Shell width="3xl">
        <Notice>Couldn’t reach the audit trail right now. {ADMIN_LOG_HINT}</Notice>
      </Shell>
    );
  }

  const filtered = !!(sp.crew || kind);

  return (
    <Shell width="3xl">
      <h1 className="text-xl font-semibold text-ink">Audit</h1>
      <p className="text-sm text-muted">
        Every event on a crew member — asked, in, out, added, removed, bailed, and
        the rest — one list, newest first.
      </p>

      <FilterForm crew={crew} sp={sp} />

      <section aria-label="Audit trail" className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
          {filtered ? " (filtered)" : ""}
        </h2>
        {rows.length === 0 ? (
          <Notice>Nothing to show — try a wider filter.</Notice>
        ) : (
          rows.map((r, i) => (
            <AuditRow key={`${r.timestamp}-${r.crewMemberId}-${r.kind}-${i}`} row={r} />
          ))
        )}
      </section>
    </Shell>
  );
}

function AuditRow({ row }: { row: AuditTrailRow }) {
  const trip =
    row.date && row.vesselName
      ? `${fmtDate(row.date)} · ${row.vesselName}`
      // eslint-disable-next-line sonarjs/no-nested-conditional -- baselined, lift to a named function (#928)
      : row.date
        ? fmtDate(row.date)
        : null;
  const secondary = [row.actorLabel, row.detail, trip].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-card px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium text-ink">{row.crewName}</span>
        <KindTag kind={row.kind} />
      </div>
      {secondary && <span className="text-sm text-muted">{secondary}</span>}
      <span className="text-xs text-faint">{fmtRunWhen(row.timestamp)}</span>
    </div>
  );
}

/** The kind as a calm neutral pill — the word carries it (BRAND, no alarm colour). */
function KindTag({ kind }: { kind: AuditKind }) {
  return (
    <span className="shrink-0 rounded-full border border-line bg-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
      {AUDIT_KIND_LABEL[kind]}
    </span>
  );
}

/** Crew + kind filter — a native GET form (no JS, DEC-026). */
function FilterForm({ crew, sp }: { crew: { id: string; name: string }[]; sp: Search }) {
  const inputClass = "min-h-[44px] rounded-card border border-line bg-card px-3 text-ink";
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-1">
        <label htmlFor="crew" className="text-xs text-muted">
          Crew
        </label>
        <select id="crew" name="crew" defaultValue={sp.crew ?? ""} className={inputClass}>
          <option value="">Everyone</option>
          {crew.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="kind" className="text-xs text-muted">
          Kind
        </label>
        <select id="kind" name="kind" defaultValue={sp.kind ?? ""} className={inputClass}>
          <option value="">All</option>
          {AUDIT_KINDS.map((k) => (
            <option key={k} value={k}>
              {AUDIT_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <GetFormSubmit className="min-h-[44px] rounded-card bg-accent px-4 font-semibold text-white">
        Filter
      </GetFormSubmit>
      {(sp.crew || sp.kind) && (
        <AppLink
          href="/admin/asks"
          className="min-h-[44px] self-end px-2 py-2 text-sm text-muted underline"
        >
          Clear
        </AppLink>
      )}
    </form>
  );
}

/** "Sat Jul 11" — the trip's calendar date, UTC-anchored (DEC-032). */
function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
