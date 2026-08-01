import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { buildCrewTimeView, type CrewTimeView } from "@core/crewapp/time-view.js";
import { BackLink } from "../../../../components/ui/back-link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { fmt12, fmtDateRange } from "../../../lib/format";
import { getRepo } from "../../../lib/repo";
import { clockInNow, clockOutNow } from "./actions";

/**
 * /crew/time (SPEC §2.9.7) — the crew member's own clock. **Clock in** when they're
 * out, **Clock out** when they're in: never both, never a guess about which they
 * meant. Below it, this pay period's punches and the total.
 *
 * A timesheet, not a tracker (§2.9): this is hours for payroll, not attendance
 * policing. Honor system by design (§2.9.3) — no geofence, no device binding.
 *
 * Server-rendered, no client JS: every form posts to a server action. The elapsed
 * line is a **render-time value, not a ticking counter** — a live timer would mean
 * client JS to make a number true that's only true at render anyway.
 */

export const dynamic = "force-dynamic";

type Search = { in?: string; out?: string; err?: string };

const ERR_COPY: Record<string, string> = {
  already_in: "You’re already on the clock — nothing changed.",
  not_in: "You weren’t on the clock, so there was nothing to close.",
  out_before_in: "That would end the punch before it started — ask the office to fix it.",
  error: "Couldn’t record that just now — try again in a moment.",
};

/**
 * "8h 30m" / "45m" — decimal hours are for payroll, not for people.
 *
 * **This is the only place elapsed time is rounded**, and it floors rather than
 * rounds: the stored value is exact to the millisecond (§2.9.6 forbids a rounding
 * policy), so the display truncates seconds instead of inflating a punch by up to
 * 30s. What goes to payroll is computed from the punches, never from this string.
 */
function fmtMinutes(total: number): string {
  const whole = Math.floor(total);
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export default async function CrewTime({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");

  let view: CrewTimeView;
  try {
    view = await buildCrewTimeView(
      getRepo(),
      asId<"CrewMemberId">(subject.id),
      new Date(),
    );
  } catch {
    return (
      <Shell>
        <Notice>Can’t reach your time right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const errCopy = sp.err ? ERR_COPY[sp.err] ?? ERR_COPY.error : null;
  const { onTheClock } = view;

  return (
    <Shell>
      <BackLink href="/crew">Back</BackLink>
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-ink">Time</h1>
        <p className="text-sm text-muted">
          Clock in when you start and out when you finish. This is what gets sent to
          payroll.
        </p>
      </header>

      {sp.in && <Notice tone="ok">You’re on the clock.</Notice>}
      {sp.out && <Notice tone="ok">Clocked out — your hours are below.</Notice>}
      {errCopy && <Notice tone="bad">{errCopy}</Notice>}

      {/* The one card, one button. `onTheClock` is the whole decision — at most one
          punch can be open (§2.9.4), so there is never an ambiguous state here. */}
      <section className="overflow-hidden rounded-card border border-line bg-card shadow-sm">
        {onTheClock ? (
          <>
            <div className="flex flex-col gap-1 border-b border-line px-4 py-3">
              <span className="font-semibold text-ink">
                On the clock since {fmt12(onTheClock.sinceTime)}
              </span>
              {onTheClock.startedOnAnEarlierDay && (
                // A forgotten clock-out (§2.9.5). Muster does not guess when someone
                // went home, so this is shown rather than closed — and until the
                // admin repair bench ships (13.3), the office is the fix.
                <span className="text-sm text-bad">
                  Started {fmtDateRange(onTheClock.sinceDate, onTheClock.sinceDate)} —
                  that’s not today. Clocking out now records the whole span; ask the
                  office to correct it.
                </span>
              )}
            </div>
            <form action={clockOutNow}>
              <SubmitButton className="min-h-[52px] w-full bg-card font-semibold text-bad">
                Clock out
              </SubmitButton>
            </form>
          </>
        ) : (
          <form action={clockInNow}>
            <SubmitButton className="min-h-[52px] w-full bg-ok font-semibold text-white">
              Clock in
            </SubmitButton>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          This pay period
        </h2>
        <p className="text-sm text-muted">{fmtDateRange(view.period.start, view.period.end)}</p>

        {view.punches.length === 0 ? (
          <Notice>No hours yet this period.</Notice>
        ) : (
          <>
            {view.punches.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-sm"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-ink">
                    {fmtDateRange(p.date, p.date)}
                  </span>
                  <span className="font-mono text-sm text-muted">
                    {fmt12(p.inTime)} – {p.outTime ? fmt12(p.outTime) : "still on the clock"}
                  </span>
                  {/* §2.9.8: hours nobody actually punched must never look identical
                      to hours they did — including to the person whose name is on them. */}
                  {p.adminTouched && (
                    <span className="text-xs text-muted">Entered or edited by the office</span>
                  )}
                </div>
                <span className="shrink-0 font-mono text-sm font-semibold text-ink">
                  {p.minutes === null ? "—" : fmtMinutes(p.minutes)}
                </span>
              </div>
            ))}

            <div className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="font-semibold text-ink">Total</span>
              <span className="font-mono font-semibold text-ink">
                {fmtMinutes(view.totalMinutes)}
              </span>
            </div>
            {/* §2.9.6: an open punch is excluded from the total and said so out loud —
                a number you can see is incomplete beats one that's silently short. */}
            {view.openCount > 0 && (
              <p className="px-4 text-xs text-muted">
                Doesn’t include the punch you haven’t closed yet.
              </p>
            )}
          </>
        )}
      </section>

      <VersionTag />
    </Shell>
  );
}
