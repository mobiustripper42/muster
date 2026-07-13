import { buildAskTrail } from "@core/admin/ask-trail.js";
import { buildAuditTrail } from "@core/admin/audit-trail.js";
import { asId } from "@core/domain/ids.js";
import { AppLink } from "../../../../components/ui/app-link";
import { BackLink } from "../../../../components/ui/back-link";
import { GetFormSubmit } from "../../../../components/ui/get-form-submit";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { fmtRunWhen } from "../../../lib/format";

/**
 * /admin/asks — the crew activity log (#400, DEC-118). ONE list combining the
 * ask trail (every ask/nudge sent + what crew answered) with the crew audit
 * (add / drop / change), newest first, filterable by crew and by kind. No second
 * page: asks and the audit live in the one list, the way it was asked for. Calm/
 * neutral — the kind is a word, not an alarm. Audit rows begin when the feature
 * shipped (no backfill); asks go back as far as the ask log.
 */

export const dynamic = "force-dynamic";

type Search = { crew?: string; kind?: string };

type Kind = "asked" | "added" | "removed" | "changed";

const KIND_LABEL: Record<Kind, string> = {
  asked: "Asked",
  added: "Added",
  removed: "Removed",
  changed: "Changed",
};

const KINDS: readonly Kind[] = ["asked", "added", "removed", "changed"];

const OUTCOME_LABEL: Record<string, string> = {
  accepted: "In",
  declined: "Out",
  timed_out: "Timed out",
  waiting: "No reply yet",
};

const asKind = (v?: string): Kind | undefined =>
  v === "asked" || v === "added" || v === "removed" || v === "changed" ? v : undefined;

/** One unified row for the combined list — an ask or an audit event. */
interface Row {
  kind: Kind;
  crewMemberId: string;
  crewName: string;
  /** The secondary line: outcome+channel for an ask, actor+reason for an audit. */
  detail: string;
  when: string; // ISO — the sort key
  date: string | null;
  vesselName: string | null;
}

export default async function AdminActivity({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin")
    return <AdminSignedOut subject={subject} />;

  const kind = asKind(sp.kind);
  const crewFilter = sp.crew ? asId<"CrewMemberId">(sp.crew) : undefined;

  let rows: Row[];
  let crew: { id: string; name: string }[];
  try {
    const repo = getRepo();
    const [asks, audit, members] = await Promise.all([
      buildAskTrail(repo, crewFilter ? { crewMemberId: crewFilter } : {}),
      buildAuditTrail(repo, crewFilter ? { crewMemberId: crewFilter } : {}),
      repo.listCrewMembers(),
    ]);

    // Ask rows → kind "asked" (the messaging: sent + answered).
    const askRows: Row[] = asks.map((a) => ({
      kind: "asked",
      crewMemberId: String(a.crewMemberId),
      crewName: a.crewName,
      detail: `${a.channel === "sms" ? "SMS" : "Push"} · ${OUTCOME_LABEL[a.outcome] ?? a.outcome}`,
      when: a.sentAt,
      date: a.date,
      vesselName: a.vesselName,
    }));

    // Audit rows → added/removed/changed. Drop the reliability-projected ADD
    // (an accepted ask) — it's already the "In" ask row above, so it isn't shown
    // twice; the projected removals (bail / no-show) stay, since asks don't cover them.
    const auditRows: Row[] = audit
      .filter((e) => !(e.source === "reliability" && e.action === "added"))
      .map((e) => ({
        kind: e.action,
        crewMemberId: String(e.crewMemberId),
        crewName: e.crewName,
        detail: e.detail ? `${e.actorLabel} · ${e.detail}` : e.actorLabel,
        when: e.timestamp,
        date: e.date,
        vesselName: e.vesselName,
      }));

    rows = [...askRows, ...auditRows]
      .filter((r) => !kind || r.kind === kind)
      .sort((a, b) => b.when.localeCompare(a.when) || a.crewName.localeCompare(b.crewName));

    crew = members
      .map((m) => ({ id: String(m.id), name: m.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return (
      <Shell width="3xl">
        <Notice>Couldn’t reach the activity log right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const filtered = !!(sp.crew || kind);

  return (
    <Shell width="3xl">
      <BackLink href="/admin">Back</BackLink>
      <h1 className="text-xl font-semibold text-ink">Audit</h1>
      <p className="text-sm text-muted">
        Every ask, and every crew add, drop, and change — one list, newest first.
        Add/drop/change records begin when this feature shipped; earlier ones
        weren’t kept.
      </p>

      <FilterForm crew={crew} sp={sp} />

      <section aria-label="Activity" className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
          {filtered ? " (filtered)" : ""}
        </h2>
        {rows.length === 0 ? (
          <Notice>Nothing to show — try a wider filter.</Notice>
        ) : (
          rows.map((r, i) => <ActivityRow key={`${r.when}-${r.crewMemberId}-${i}`} row={r} />)
        )}
      </section>
    </Shell>
  );
}

function ActivityRow({ row }: { row: Row }) {
  const trip =
    row.date && row.vesselName
      ? `${fmtDate(row.date)} · ${row.vesselName}`
      : row.date
        ? fmtDate(row.date)
        : null;
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-card px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium text-ink">{row.crewName}</span>
        <KindTag kind={row.kind} />
      </div>
      <span className="text-sm text-muted">
        {row.detail}
        {trip ? ` · ${trip}` : ""}
      </span>
      <span className="text-xs text-faint">{fmtRunWhen(row.when)}</span>
    </div>
  );
}

/** The kind as a calm neutral pill — the word carries it (BRAND, no alarm colour). */
function KindTag({ kind }: { kind: Kind }) {
  return (
    <span className="shrink-0 rounded-full border border-line bg-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
      {KIND_LABEL[kind]}
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
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
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
