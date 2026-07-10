import { buildAskTrail, type AskTrailRow, type AskOutcome } from "@core/admin/ask-trail.js";
import { asId } from "@core/domain/ids.js";
import { AppLink } from "../../../../components/ui/app-link";
import { BackLink } from "../../../../components/ui/back-link";
import { GetFormSubmit } from "../../../../components/ui/get-form-submit";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { fmtRunWhen } from "../../../lib/format";

/**
 * /admin/asks (#331) — the ask trail: every ask the engine fired, newest first,
 * filterable per crew / per day / per shift. A deliberate PULL surface (the
 * all-shifts idiom, DEC-042) — the operator opens it to answer "what actually got
 * sent to <crew>, and when?" without a raw DB query (the 2026-07-09 case). Read
 * over `buildAskTrail`; a re-ask/nudge is its own row, so a double-nudge shows as
 * two rows here. Calm/neutral like all-shifts — outcome is a word, not an alarm.
 */

export const dynamic = "force-dynamic";

type Search = { crew?: string; day?: string; shift?: string };

const OUTCOME_LABEL: Record<AskOutcome, string> = {
  accepted: "In",
  declined: "Out",
  timed_out: "Timed out",
  waiting: "No reply yet",
};

export default async function AdminAsks({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <SignedOut />;

  let rows: AskTrailRow[];
  let crew: { id: string; name: string }[];
  try {
    const repo = getRepo();
    const [trail, members] = await Promise.all([
      buildAskTrail(repo, {
        ...(sp.crew ? { crewMemberId: asId<"CrewMemberId">(sp.crew) } : {}),
        ...(sp.shift ? { shiftId: asId<"ShiftId">(sp.shift) } : {}),
        ...(sp.day ? { day: sp.day } : {}),
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
        <Notice>Couldn’t reach the ask history right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const filtered = !!(sp.crew || sp.day || sp.shift);

  return (
    <Shell width="3xl">
      <BackLink href="/admin">Back</BackLink>
      <h1 className="text-xl font-semibold text-ink">Ask history</h1>
      <p className="text-sm text-muted">
        Every ask the engine sent — who, which trip, when, and what they answered. A
        re-ask or nudge is its own line.
      </p>

      {sp.shift && (
        <Notice>
          Showing one shift.{" "}
          <AppLink href="/admin/asks" className="text-accent underline">
            Show all
          </AppLink>
        </Notice>
      )}

      <FilterForm crew={crew} sp={sp} />

      <section aria-label="Ask history" className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {rows.length} {rows.length === 1 ? "ask" : "asks"}
          {filtered ? " (filtered)" : ""}
        </h2>
        {rows.length === 0 ? (
          <Notice>No asks match — try a wider filter.</Notice>
        ) : (
          rows.map((r) => <AskRow key={r.askId} row={r} />)
        )}
      </section>
    </Shell>
  );
}

function AskRow({ row }: { row: AskTrailRow }) {
  const trip =
    row.date && row.vesselName
      ? `${fmtDate(row.date)} · ${row.vesselName}${row.roleName ? ` · ${row.roleName}` : ""}`
      : "(seat no longer on the books)";
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-card px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium text-ink">{trip}</span>
        <OutcomeTag outcome={row.outcome} />
      </div>
      <span className="text-sm text-muted">
        {row.crewName} · {row.channel === "sms" ? "SMS" : "Push"}
      </span>
      <span className="text-xs text-faint">
        Sent {fmtRunWhen(row.sentAt)}
        {row.respondedAt ? ` · answered ${fmtRunWhen(row.respondedAt)}` : ""}
      </span>
    </div>
  );
}

/** Outcome as a calm neutral pill — the word carries it (all-shifts neutrality;
 *  no alarm colour on a pull surface, BRAND). */
function OutcomeTag({ outcome }: { outcome: AskOutcome }) {
  return (
    <span className="shrink-0 rounded-full border border-line bg-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

/** Crew + day filter — a native GET form (no JS, DEC-026); `shift` (a deep-link
 *  param) rides as a hidden field so filtering within a shift keeps the scope. */
function FilterForm({ crew, sp }: { crew: { id: string; name: string }[]; sp: Search }) {
  const inputClass = "min-h-[44px] rounded-card border border-line bg-card px-3 text-ink";
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-sm">
      {sp.shift && <input type="hidden" name="shift" value={sp.shift} />}
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
        <label htmlFor="day" className="text-xs text-muted">
          Trip date
        </label>
        <input id="day" name="day" type="date" defaultValue={sp.day ?? ""} className={inputClass} />
      </div>
      <GetFormSubmit className="min-h-[44px] rounded-card bg-accent px-4 font-semibold text-white">
        Filter
      </GetFormSubmit>
      {(sp.crew || sp.day) && (
        <AppLink
          href={sp.shift ? `/admin/asks?shift=${sp.shift}` : "/admin/asks"}
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

function SignedOut() {
  return (
    <Shell width="3xl">
      <h1 className="text-lg font-semibold text-ink">Muster · Admin</h1>
      <Notice>You’re signed out. Tap an operator magic link to get in.</Notice>
    </Shell>
  );
}
