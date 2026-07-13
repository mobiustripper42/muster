import {
  buildAuditTrail,
  type AuditTrailRow,
  type AuditAction,
} from "@core/admin/audit-trail.js";
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
 * /admin/audit (#400 Slice B, DEC-118) — the crew audit trail: ONE list of every
 * crew add / drop / change, newest first, filterable by crew and by kind. A pull
 * surface like /admin/asks (all-shifts idiom, DEC-042) — the operator opens it to
 * answer "who put <crew> on / took them off this boat, and when?" One list, two
 * sources unioned under the hood (`buildAuditTrail`): the audit facts + the
 * add/drop projection over reliability. Calm/neutral — the action is a word, not
 * an alarm. NO backfill: capture began when this shipped; the header says so.
 */

export const dynamic = "force-dynamic";

type Search = { crew?: string; kind?: string };

const ACTION_LABEL: Record<AuditAction, string> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
};

const KINDS: readonly AuditAction[] = ["added", "removed", "changed"];

const asAction = (v?: string): AuditAction | undefined =>
  v === "added" || v === "removed" || v === "changed" ? v : undefined;

export default async function AdminAudit({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin")
    return <AdminSignedOut subject={subject} />;

  const action = asAction(sp.kind);

  let rows: AuditTrailRow[];
  let crew: { id: string; name: string }[];
  try {
    const repo = getRepo();
    const [trail, members] = await Promise.all([
      buildAuditTrail(repo, {
        ...(sp.crew ? { crewMemberId: asId<"CrewMemberId">(sp.crew) } : {}),
        ...(action ? { action } : {}),
      }),
      repo.listCrewMembers(),
    ]);
    rows = trail;
    crew = members
      .map((m) => ({ id: String(m.id), name: m.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return (
      <Shell width="3xl">
        <Notice>Couldn’t reach the audit trail right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const filtered = !!(sp.crew || action);

  return (
    <Shell width="3xl">
      <BackLink href="/admin">Back</BackLink>
      <h1 className="text-xl font-semibold text-ink">Audit</h1>
      <p className="text-sm text-muted">
        Every crew add, drop, and change — who it happened to, what happened, and
        who did it. Records begin when this feature shipped; earlier changes
        weren’t kept.
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
          rows.map((r, i) => <AuditRow key={`${r.timestamp}-${r.crewMemberId}-${i}`} row={r} />)
        )}
      </section>
    </Shell>
  );
}

function AuditRow({ row }: { row: AuditTrailRow }) {
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
        <ActionTag action={row.action} />
      </div>
      <span className="text-sm text-muted">
        {row.actorLabel}
        {row.detail ? ` · ${row.detail}` : ""}
        {trip ? ` · ${trip}` : ""}
      </span>
      <span className="text-xs text-faint">{fmtRunWhen(row.timestamp)}</span>
    </div>
  );
}

/** The action as a calm neutral pill — the word carries it (BRAND, no alarm
 *  colour on a pull surface, matching /admin/asks). */
function ActionTag({ action }: { action: AuditAction }) {
  return (
    <span className="shrink-0 rounded-full border border-line bg-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
      {ACTION_LABEL[action]}
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
              {ACTION_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <GetFormSubmit className="min-h-[44px] rounded-card bg-accent px-4 font-semibold text-white">
        Filter
      </GetFormSubmit>
      {(sp.crew || sp.kind) && (
        <AppLink
          href="/admin/audit"
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
