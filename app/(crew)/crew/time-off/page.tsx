import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { sortWindows } from "@core/crew/time-off.js";
import type { PtoWindow } from "@core/domain/entities.js";
import { CrewHeader } from "../../../../components/crew/crew-header";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { errCopyFor } from "../../../lib/err-copy";
import { readFormDraft, type FormDraft } from "../../../lib/form-draft";
import { fmtDateRange } from "../../../lib/format";
import { getRepo } from "../../../lib/repo";
import { addMyTimeOff, removeMyTimeOff, setMyDaysOff, type CrewTimeOffErr } from "./actions";

/**
 * /crew/time-off (SPEC §2.1, DEC-009) — the crew member's own time off, two axes on
 * one surface: specific **dated windows** ("Days I'm off", add/remove) and a
 * **recurring weekday** blackout ("Weekdays I never work", #426/DEC-119). Both are
 * subtractive — a window or a checked weekday means OFF; absence means available.
 * This is NOT an availability/scheduling screen (DEC-009). Server-rendered, no
 * client JS (DEC-026): every form posts to a server action. Mobile-primary (DEC-085).
 */

export const dynamic = "force-dynamic";

type Search = { added?: string; removed?: string; saved?: string; err?: string };

const ERR_COPY: Record<CrewTimeOffErr, string> = {
  bad_date: "That date didn’t look right — check the day and try again.",
  end_before_start: "The end date is before the start — flip them and try again.",
  error: "Couldn’t save that just now — try again in a moment.",
};

// Mon=0…Sun=6 (DEC-119 convention). Display order = the week, Monday first.
const WEEKDAYS: readonly { value: number; label: string }[] = [
  { value: 0, label: "Monday" },
  { value: 1, label: "Tuesday" },
  { value: 2, label: "Wednesday" },
  { value: 3, label: "Thursday" },
  { value: 4, label: "Friday" },
  { value: 5, label: "Saturday" },
  { value: 6, label: "Sunday" },
];

export default async function CrewTimeOff({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");

  let windows: PtoWindow[];
  let weekdaysOff: number[];
  try {
    const repo = getRepo();
    const id = asId<"CrewMemberId">(subject.id);
    const [w, crew] = await Promise.all([
      repo.listPtoWindowsForCrew(id),
      repo.getCrewMember(id),
    ]);
    windows = sortWindows(w);
    weekdaysOff = crew?.weekdaysOff ?? [];
  } catch {
    return (
      <Shell>
        <Notice>Can’t reach your time off right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const errCopy = errCopyFor(ERR_COPY, sp.err, "error");
  // The refused add's own dates (#780). Every other door on this page clears the draft, so
  // whatever is here belongs to the last refused add and nothing else.
  const draft = sp.err ? await readFormDraft("/crew/time-off") : null;
  const offSet = new Set(weekdaysOff);

  return (
    <Shell>
      <CrewHeader title="Time off" back={{ href: "/crew", label: "My shifts" }} current="/crew/time-off" />
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">
          Days and weekdays you’re off. You won’t be asked for shifts on them —
          there’s nothing to opt into, so anything not listed here means you’re
          available.
        </p>
      </header>

      {sp.added && <Notice tone="ok">Added — you’re off those dates.</Notice>}
      {sp.removed && <Notice tone="ok">Removed — you’re available those dates again.</Notice>}
      {sp.saved && <Notice tone="ok">Saved — your recurring days off are updated.</Notice>}
      {errCopy && <Notice tone="bad">{errCopy}</Notice>}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Days I’m off
        </h2>
        {windows.length === 0 ? (
          <Notice>Nothing set — you’re available for asks on every date.</Notice>
        ) : (
          windows.map((w) => (
            <div
              key={w.id}
              className="flex items-center justify-between gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-sm"
            >
              <span className="font-medium text-ink">{fmtDateRange(w.start, w.end)}</span>
              <form action={removeMyTimeOff}>
                <input type="hidden" name="id" value={w.id} />
                <SubmitButton className="text-sm text-bad underline">Remove</SubmitButton>
              </form>
            </div>
          ))
        )}
      </section>

      <AddForm action={addMyTimeOff} draft={draft} />

      {/* Recurring weekday blackout (#426, DEC-119) — the every-Sunday-forever axis,
          distinct from the dated windows above but the same subtractive idea. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Weekdays I never work
        </h2>
        <p className="text-sm text-muted">
          Check the days you’re never available. You won’t be asked for shifts on
          them, every week until you change it.
        </p>
        <form
          action={setMyDaysOff}
          className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-4 shadow-sm"
        >
          <ul className="flex flex-col">
            {WEEKDAYS.map((d) => (
              <li key={d.value} className="border-b border-line last:border-b-0">
                <label
                  htmlFor={`day-${d.value}`}
                  className="flex min-h-[52px] cursor-pointer items-center gap-3"
                >
                  <input
                    id={`day-${d.value}`}
                    type="checkbox"
                    name="days"
                    value={d.value}
                    defaultChecked={offSet.has(d.value)}
                    className="h-5 w-5 accent-accent"
                  />
                  <span className="font-medium text-ink">{d.label}</span>
                </label>
              </li>
            ))}
          </ul>
          <SubmitButton className="min-h-[52px] w-full rounded-card bg-accent font-semibold text-white">
            Save
          </SubmitButton>
        </form>
      </section>

      <VersionTag />
    </Shell>
  );
}

/** The add-a-window form — two native date inputs (mobile date pickers, no JS)
 *  and one button. `end` defaults to whatever `start` is via required inputs;
 *  the domain enforces `start ≤ end`, so a same-day off is just start === end. */
function AddForm({
  action,
  draft,
}: {
  action: (fd: FormData) => Promise<void>;
  draft: FormDraft | null;
}) {
  const inputClass =
    "min-h-[52px] rounded-card border border-line bg-card px-4 text-ink";
  return (
    <form action={action} className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-4 shadow-sm">
      <h2 className="text-sm font-semibold text-ink">Add time off</h2>
      <div className="flex flex-col gap-2">
        <label htmlFor="start" className="text-sm text-muted">
          First day off
        </label>
        <input
          id="start"
          name="start"
          type="date"
          defaultValue={draft?.get("start") ?? ""}
          required
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="end" className="text-sm text-muted">
          Last day off (same day for a single day)
        </label>
        <input
          id="end"
          name="end"
          type="date"
          defaultValue={draft?.get("end") ?? ""}
          required
          className={inputClass}
        />
      </div>
      <SubmitButton className="min-h-[52px] w-full rounded-card bg-accent font-semibold text-white">
        Add
      </SubmitButton>
    </form>
  );
}
