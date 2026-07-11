import { buildAllTimeOff, type TimeOffByCrew } from "@core/crew/time-off.js";
import type { CrewMember } from "@core/domain/entities.js";
import { BackLink } from "../../../../components/ui/back-link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { fmtDateRange } from "../../../lib/format";
import { getRepo } from "../../../lib/repo";
import { adminAddTimeOff, adminRemoveTimeOff } from "./actions";

/**
 * /admin/time-off (#332, SPEC §2.1, DEC-009) — the office's view of everyone's
 * time off, plus the lever to set it. Scan who's out before working a shift; put
 * a crew member out (e.g. active-duty leave — a far-future end date = "indefinite").
 * Operator authority: add for anyone, remove anyone's (no ownership gate). Read
 * over `buildAllTimeOff`; still subtractive (DEC-009 — off-dates, not availability).
 */

export const dynamic = "force-dynamic";

type Search = { added?: string; removed?: string; err?: string };

const ERR_COPY: Record<string, string> = {
  bad_date: "That date didn’t look right — check the day and try again.",
  end_before_start: "The end date is before the start — flip them and try again.",
  no_crew: "Pick a crew member first.",
  error: "Couldn’t save that just now — try again in a moment.",
};

export default async function AdminTimeOff({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin")
    return <AdminSignedOut subject={subject} />;

  let groups: TimeOffByCrew[];
  let crew: CrewMember[];
  try {
    const repo = getRepo();
    [groups, crew] = await Promise.all([
      buildAllTimeOff(repo),
      repo.listCrewMembers(),
    ]);
  } catch {
    return (
      <Shell width="3xl">
        <Notice>Couldn’t reach the roster right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  // Pickable = everyone still on lists (archived crew are off everything already).
  const pickable = crew
    .filter((c) => c.status !== "archived")
    .sort((a, b) => a.name.localeCompare(b.name));
  const errCopy = sp.err ? ERR_COPY[sp.err] ?? ERR_COPY.error : null;

  return (
    <Shell width="3xl">
      <BackLink href="/admin">Back</BackLink>
      <h1 className="text-xl font-semibold text-ink">Time off</h1>
      <p className="text-sm text-muted">
        Who’s out, and when. Crew don’t get asked for shifts on these dates. For
        someone out indefinitely (e.g. active-duty leave), set a far-off end date.
      </p>

      {sp.added && <Notice tone="ok">Added.</Notice>}
      {sp.removed && <Notice tone="ok">Removed.</Notice>}
      {errCopy && <Notice tone="bad">{errCopy}</Notice>}

      <AddForm crew={pickable} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Everyone’s time off
        </h2>
        {groups.length === 0 ? (
          <Notice>No time off on the books — everyone’s available.</Notice>
        ) : (
          groups.map((g) => (
            <div
              key={g.crewMemberId}
              className={`flex flex-col gap-2 rounded-card border border-line px-4 py-3 shadow-sm ${
                g.archived ? "bg-bg opacity-60" : "bg-card"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="font-semibold text-ink">{g.crewName}</span>
                {g.archived && (
                  <span className="rounded-full border border-line bg-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                    Archived
                  </span>
                )}
              </span>
              <ul className="flex flex-col gap-1">
                {g.windows.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-ink">{fmtDateRange(w.start, w.end)}</span>
                    <form action={adminRemoveTimeOff}>
                      <input type="hidden" name="id" value={w.id} />
                      <SubmitButton className="text-sm text-bad underline">
                        Remove
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <VersionTag />
    </Shell>
  );
}

/** Put a crew member out — pick who, then the span. Native date inputs, no JS
 *  (DEC-026). The domain enforces `start ≤ end`. */
function AddForm({ crew }: { crew: CrewMember[] }) {
  const inputClass = "min-h-[48px] rounded-card border border-line bg-card px-3 text-ink";
  return (
    <form
      action={adminAddTimeOff}
      className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-4 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-ink">Add time off</h2>
      <div className="flex flex-col gap-2">
        <label htmlFor="crewMemberId" className="text-sm text-muted">
          Crew member
        </label>
        <select id="crewMemberId" name="crewMemberId" required className={inputClass} defaultValue="">
          <option value="" disabled>
            Select crew…
          </option>
          {crew.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex flex-1 flex-col gap-2">
          <label htmlFor="start" className="text-sm text-muted">
            First day off
          </label>
          <input id="start" name="start" type="date" required className={inputClass} />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <label htmlFor="end" className="text-sm text-muted">
            Last day off
          </label>
          <input id="end" name="end" type="date" required className={inputClass} />
        </div>
      </div>
      <SubmitButton className="min-h-[48px] rounded-card bg-accent px-4 font-semibold text-white">
        Add time off
      </SubmitButton>
    </form>
  );
}