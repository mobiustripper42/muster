import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { sortWindows } from "@core/crew/time-off.js";
import type { PtoWindow } from "@core/domain/entities.js";
import { BackLink } from "../../../../components/ui/back-link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { fmtDateRange } from "../../../lib/format";
import { getRepo } from "../../../lib/repo";
import { addMyTimeOff, removeMyTimeOff } from "./actions";

/**
 * /crew/time-off (SPEC §2.1, DEC-009) — the crew member's own blackout dates:
 * "Days I'm off." Add a window (start–end), remove one. Subtractive by design —
 * this is NOT an availability/scheduling screen (DEC-009: a window means OFF;
 * absence means available). Server-rendered, no client JS (DEC-026): both forms
 * post to server actions. Mobile-primary (DEC-085).
 */

export const dynamic = "force-dynamic";

type Search = { added?: string; removed?: string; err?: string };

const ERR_COPY: Record<string, string> = {
  bad_date: "That date didn’t look right — check the day and try again.",
  end_before_start: "The end date is before the start — flip them and try again.",
  error: "Couldn’t save that just now — try again in a moment.",
};

export default async function CrewTimeOff({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");

  let windows: PtoWindow[];
  try {
    windows = sortWindows(
      await getRepo().listPtoWindowsForCrew(asId<"CrewMemberId">(subject.id)),
    );
  } catch {
    return (
      <Shell>
        <Notice>Can’t reach your time off right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const errCopy = sp.err ? ERR_COPY[sp.err] ?? ERR_COPY.error : null;

  return (
    <Shell>
      <BackLink href="/crew">Back</BackLink>
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-ink">Time off</h1>
        <p className="text-sm text-muted">
          Days you’re off. You won’t be asked for shifts on these dates. Leave a day
          off this list and you’re available — there’s nothing to opt into.
        </p>
      </header>

      {sp.added && <Notice tone="ok">Added — you’re off those dates.</Notice>}
      {sp.removed && <Notice tone="ok">Removed — you’re available those dates again.</Notice>}
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

      <AddForm action={addMyTimeOff} />

      {/* Sibling axis (#426, DEC-119): recurring weekdays ("never Sundays"), as
          opposed to the specific dated windows above. Kept as its own surface. */}
      <a
        href="/crew/days-off"
        className="text-sm text-muted underline underline-offset-2"
      >
        Never work certain weekdays? Set recurring days off →
      </a>

      <VersionTag />
    </Shell>
  );
}

/** The add-a-window form — two native date inputs (mobile date pickers, no JS)
 *  and one button. `end` defaults to whatever `start` is via required inputs;
 *  the domain enforces `start ≤ end`, so a same-day off is just start === end. */
function AddForm({ action }: { action: (fd: FormData) => Promise<void> }) {
  const inputClass =
    "min-h-[52px] rounded-card border border-line bg-card px-4 text-ink";
  return (
    <form action={action} className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-4 shadow-sm">
      <h2 className="text-sm font-semibold text-ink">Add time off</h2>
      <div className="flex flex-col gap-2">
        <label htmlFor="start" className="text-sm text-muted">
          First day off
        </label>
        <input id="start" name="start" type="date" required className={inputClass} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="end" className="text-sm text-muted">
          Last day off (same day for a single day)
        </label>
        <input id="end" name="end" type="date" required className={inputClass} />
      </div>
      <SubmitButton className="min-h-[52px] w-full rounded-card bg-accent font-semibold text-white">
        Add
      </SubmitButton>
    </form>
  );
}
