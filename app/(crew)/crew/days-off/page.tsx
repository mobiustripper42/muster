import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { BackLink } from "../../../../components/ui/back-link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { setMyDaysOff } from "./actions";

/**
 * /crew/days-off (#426, DEC-119) — the crew member's own RECURRING weekday
 * blackout: "Weekdays I never work." Sibling to /crew/time-off (dated windows,
 * DEC-009); this is the every-Sunday-forever axis. Subtractive by design — an
 * unchecked day means available, there's nothing to opt into. Server-rendered,
 * no client JS (DEC-026): the checkbox form posts to a server action and REPLACES
 * the whole set. Mobile-primary (DEC-085), works the same on desktop.
 */

export const dynamic = "force-dynamic";

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

type Search = { saved?: string; err?: string };

export default async function CrewDaysOff({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");

  let off: number[];
  try {
    const crew = await getRepo().getCrewMember(asId<"CrewMemberId">(subject.id));
    if (!crew) redirect("/crew");
    off = crew.weekdaysOff ?? [];
  } catch {
    return (
      <Shell>
        <Notice>Can’t reach your days off right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const offSet = new Set(off);

  return (
    <Shell>
      <BackLink href="/crew/time-off">Back</BackLink>
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-ink">Weekdays I never work</h1>
        <p className="text-sm text-muted">
          Check the weekdays you’re never available. You won’t be asked for shifts on
          them — every week, until you change it. Leave a day unchecked and you’re
          available. This is separate from specific dates on{" "}
          <span className="whitespace-nowrap">Time off</span>.
        </p>
      </header>

      {sp.saved && <Notice tone="ok">Saved — your recurring days off are updated.</Notice>}
      {sp.err && <Notice tone="bad">Couldn’t save that just now — try again in a moment.</Notice>}

      <form
        action={setMyDaysOff}
        className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-4 shadow-sm"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Days I never work
        </h2>
        <ul className="flex flex-col">
          {WEEKDAYS.map((d) => (
            <li key={d.value}>
              <label
                htmlFor={`day-${d.value}`}
                className="flex min-h-[52px] cursor-pointer items-center gap-3 border-b border-line last:border-b-0"
              >
                <input
                  id={`day-${d.value}`}
                  type="checkbox"
                  name="days"
                  value={d.value}
                  defaultChecked={offSet.has(d.value)}
                  className="h-5 w-5 rounded border-line accent-accent"
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

      <VersionTag />
    </Shell>
  );
}
