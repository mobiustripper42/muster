import { notFound, redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { PAY_PERIOD_ANCHOR, vesselDateOf } from "@core/config/tenant.js";
import { compactDuration } from "@core/admin/hours-format.js";
import { currentPeriod, periodsForYear } from "@core/admin/pay-periods.js";
import { buildCrewTimeView, type CrewTimeView } from "@core/crewapp/time-view.js";
import { CrewHeader } from "../../../../components/crew/crew-header";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { errCopyFor } from "../../../lib/err-copy";
import { readFormDraft, type FormDraft } from "../../../lib/form-draft";
import { timeClockEnabled } from "../../../lib/flags";
import { fmt12, fmtDateRange } from "../../../lib/format";
import { getRepo } from "../../../lib/repo";
import { AppLink } from "../../../../components/ui/app-link";
import { DirtySubmit } from "../../../../components/admin/dirty-submit";
import { AutoSubmitSelect } from "../../../../components/admin/auto-submit-select";
import {
  addMyPunch,
  clockInNow,
  clockOutNow,
  deleteMyPunch,
  editMyPunch,
  type CrewTimeErr,
} from "./actions";

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

type Search = {
  period?: string;
  in?: string;
  out?: string;
  err?: string;
  saved?: string;
  added?: string;
  deleted?: string;
  /** Which punch is open for editing — one at a time, by construction (#635). */
  edit?: string;
  /** The add form is open. */
  add?: string;
};

const ERR_COPY: Record<CrewTimeErr, string> = {
  already_in: "You’re already on the clock — nothing changed.",
  not_in: "You weren’t on the clock, so there was nothing to close.",
  // #635 made this fixable by the person reading it — before crew edit, this copy sent
  // them to the office, which is no longer where the fix lives.
  out_before_in: "That would end the punch before it started — check the times.",
  error: "Couldn’t record that just now — try again in a moment.",
  reason_required: "Add a short note saying why — it goes on the record with the change.",
  day_moved:
    "That time would move the punch to a different day. Delete it and add it on the right day instead.",
  gone: "That punch isn’t there any more.",
  bad_input: "Something was missing — check the times and try again.",
  future: "That time hasn’t happened yet — a punch records work you've done.",
};

export default async function CrewTime({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  // Phase dark (#628): 404 the ROUTE, not just the hub tile. A flag that only hides an entry
  // point is the #621 defect — the URL still works for anyone who has it.
  if (!timeClockEnabled()) notFound();

  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");

  let view: CrewTimeView;
  try {
    const [selFrom, selTo] = (sp.period ?? "").split("|");
    const isDay = (d?: string): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
    const chosen = isDay(selFrom) && isDay(selTo) ? { start: selFrom, end: selTo } : undefined;
    view = await buildCrewTimeView(
      getRepo(),
      asId<"CrewMemberId">(subject.id),
      new Date(),
      chosen,
    );
  } catch {
    return (
      <Shell>
        <Notice>Can’t reach your time right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const errCopy = errCopyFor(ERR_COPY, sp.err, "error");
  // A refused save rides its own values back (#780). Read only on `?err=`, so an editor opened
  // by tapping a row never inherits a minute-old refusal from a different one.
  const draft = sp.err ? await readFormDraft("/crew/time") : null;
  const { onTheClock } = view;
  // Exactly one editor at a time (#635). Everything else renders inert while it's open,
  // which is why this is one boolean rather than per-row state.
  // Only an id that actually matches one of THEIR punches counts as open. A stale
  // bookmark, a deleted punch, or a hand-typed id would otherwise render every row
  // inert with no visible way back — the editor that would carry Cancel never opens.
  const editing = view.punches.some((p) => String(p.id) === sp.edit) ? sp.edit : undefined;
  const anyOpen = editing !== undefined || sp.add !== undefined;
  // Which clock control is inert. Named once rather than inlined twice: #718's whole point is
  // that these two are one decision with two faces, and computing them apart is how they drift.
  // `onTheClock` is `null` when off (`src/crewapp/time-view.ts:70`) — reading it as `undefined`
  // disabled both buttons at rest, which is how this was first written.
  const clockInOff = onTheClock !== null || anyOpen;
  const clockOutOff = onTheClock === null || anyOpen;
  const today = vesselDateOf(new Date());
  const thisPeriod = currentPeriod(PAY_PERIOD_ANCHOR, today);

  return (
    <Shell>
      <CrewHeader title="Time" back={{ href: "/crew", label: "My shifts" }} current="/crew/time" />
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">
          Clock in and out for your shift. Tap a punch to edit it, or add one you missed.
        </p>
      </header>

      {/* BOTH buttons, always, in fixed positions — one enabled (#718, DEC-152 amending
          SPEC §2.9.7). The spec said "one card, one button … never both, never a guess about
          which they meant", and bought that unambiguity by MOVING the control: clocking out
          removed the status line, the sole button slid up 46px, and its new box overlapped the
          old one by 6px. A crew member clocked out and straight back in on the first live day.
          A disabled twin cannot be mis-tapped; a moving button can.

          Everything that changes size now lives BELOW the buttons — the status line above them
          renders in both states so it cannot collapse, and the earlier-day warning and the
          notices moved down. Nothing above a button may vary in height; that is the whole rule
          and it is measured in `crew-time.spec.ts` ("neither clock button moves across a
          punch") rather than eyeballed. */}
      <section className="overflow-hidden rounded-card border border-line bg-card shadow-sm">
        <div className="border-b border-line px-4 py-3">
          <span className="font-semibold text-ink">
            {onTheClock ? `On the clock since ${fmt12(onTheClock.sinceTime)}` : "Not on the clock"}
          </span>
        </div>

        {/* Order is fixed and never reorders: Clock in, then Clock out. `disabled` on the one
            that does not apply — and mid-edit BOTH are disabled rather than replaced by a
            message, which is the same reason: a control that vanishes is a control whose
            neighbour moves into its place.

            GREEN FOLLOWS ENABLEMENT, not identity (operator, 2026-08-09). Green is not "this
            is Clock in", it is "this is the live action" — so it moves between the two as the
            state changes, and the disabled twin is inert grey. Separated and rounded rather
            than flush, so they read as two discrete controls: the single full-bleed green
            button is the right shape for the ask in/out surface, where there IS one action.
            Here there are two and only one is live, which is a different thing to say. */}
        <div className="flex flex-col gap-2 p-3">
          <form action={clockInNow}>
            <SubmitButton disabled={clockInOff} className={clockBtn(!clockInOff)}>
              Clock in
            </SubmitButton>
          </form>
          {/* NOT `text-bad` when live. Clocking out is the ordinary end of a shift, not an
              error or a destructive act — `bad` stays reserved for the earlier-day warning
              below and for Delete on the admin bench. */}
          <form action={clockOutNow}>
            <SubmitButton disabled={clockOutOff} className={clockBtn(!clockOutOff)}>
              Clock out
            </SubmitButton>
          </form>
        </div>

        {onTheClock?.startedOnAnEarlierDay && (
          // A forgotten clock-out (§2.9.5). Muster does not guess when someone went home, so
          // this is shown rather than closed — and until the admin repair bench ships (13.3),
          // the office is the fix. BELOW the buttons since #718: it is conditional, so above
          // them it would move both every time it appeared.
          <p className="border-t border-line px-4 py-3 text-sm text-bad">
            Started {fmtDateRange(onTheClock.sinceDate, onTheClock.sinceDate)} — that’s not
            today. Clocking out now records the whole span; ask the office to correct it.
          </p>
        )}
        {anyOpen && <ClockBusy />}
      </section>

      {/* BELOW the card since #718. These appear and disappear on every punch and change
          length between "You’re on the clock." and "Clocked out — your hours are below." — so
          above the card they moved both buttons every single time. Where they finally sit is
          the operator's call once he has seen it work; that they cannot be above the buttons
          is not. */}
      {sp.in && <Notice tone="ok">You’re on the clock.</Notice>}
      {sp.out && <Notice tone="ok">Clocked out — your hours are below.</Notice>}
      {sp.saved && <Notice tone="ok">Saved.</Notice>}
      {sp.added && <Notice tone="ok">Added.</Notice>}
      {sp.deleted && <Notice tone="ok">Deleted.</Notice>}
      {errCopy && <Notice tone="bad">{errCopy}</Notice>}

      <section className="flex flex-col gap-2">
        {/* Crew can look at a past period — "what did I get paid for last time" is a
            question they have, and the answer was previously only the operator's. */}
        <form method="get" className="flex flex-col gap-1">
          <label htmlFor="period" className="sr-only">
            Pay period
          </label>
          <AutoSubmitSelect
            name="period"
            value={`${view.period.start}|${view.period.end}`}
            options={periodsForYear(PAY_PERIOD_ANCHOR, Number(today.slice(0, 4))).map((p) => ({
              value: `${p.start}|${p.end}`,
              label: `${fmtDateRange(p.start, p.end)}${p.start === thisPeriod.start ? " — current" : ""}`,
            }))}
            ariaLabel="Pay period"
            className="min-h-[44px] rounded-card border border-line bg-card px-3 text-ink"
          />
        </form>

        {view.punches.length === 0 ? (
          <Notice>No hours yet this period.</Notice>
        ) : (
          <>
            {view.punches.map((p) => {
              const open = editing === String(p.id);
              return (
                <div
                  key={p.id}
                  id={`punch-${p.id}`}
                  className={`flex flex-col rounded-card border bg-card shadow-sm ${
                    open ? "border-accent" : "border-line"
                  }`}
                >
                  {/* The row. Tapping it opens THIS one for editing — and because the
                      open editor is keyed to `?edit=<id>`, opening one closes any other
                      by construction rather than by script. While one is open the rest
                      render as plain text: no second editor, no competing affordance. */}
                  {open || anyOpen ? (
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <PunchFacts punch={p} />
                      <span className="shrink-0 font-mono text-sm font-semibold text-ink">
                        {p.minutes === null ? "—" : compactDuration(p.minutes)}
                      </span>
                    </div>
                  ) : (
                    <AppLink
                      href={`/crew/time?edit=${encodeURIComponent(String(p.id))}#punch-${p.id}`}
                      prefetch={false}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <PunchFacts punch={p} />
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-ink">
                          {p.minutes === null ? "—" : compactDuration(p.minutes)}
                        </span>
                        <span className="text-faint" aria-hidden>
                          ›
                        </span>
                      </span>
                    </AppLink>
                  )}

                  {open && (
                    <PunchForm
                      mode="edit"
                      punchId={String(p.id)}
                      day={p.date}
                      inTime={p.inTime}
                      outTime={p.outTime}
                      outIsNextDay={p.outIsNextDay}
                      draft={draft}
                    />
                  )}
                </div>
              );
            })}

            <div className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="font-semibold text-ink">Total</span>
              <span className="font-mono font-semibold text-ink">
                {compactDuration(view.totalMinutes)}
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

        {/* Add sits after the list, not fixed to the bottom: a pay period is a couple
            of dozen rows, so it's already reachable, and a sticky bar would cost a
            permanent strip of a 375px screen and crowd the VersionTag. */}
        {sp.add ? (
          <div id="punch-new" className="rounded-card border border-accent bg-card shadow-sm">
            <PunchForm mode="add" day={today} draft={draft} />
          </div>
        ) : (
          !anyOpen && (
            <AppLink
              href="/crew/time?add=1#punch-new"
              prefetch={false}
              className="flex min-h-[52px] items-center justify-center rounded-card border border-line bg-card font-semibold text-ink shadow-sm"
            >
              Add hours
            </AppLink>
          )
        )}
      </section>

      <VersionTag />
    </Shell>
  );
}

/** The facts half of a punch row — shared by the tappable and the inert renderings so
 *  they can't drift into looking like different rows. */
function PunchFacts({
  punch,
}: {
  punch: { date: string; inTime: string; outTime: string | null; adminTouched: boolean };
}) {
  return (
    <span className="flex flex-col">
      <span className="font-medium text-ink">{fmtDateRange(punch.date, punch.date)}</span>
      <span className="font-mono text-sm text-muted">
        {fmt12(punch.inTime)} –{" "}
        {punch.outTime ? fmt12(punch.outTime) : "still on the clock"}
      </span>
      {/* §2.9.8: hours nobody actually punched must never look identical to hours they
          did — including to the person whose name is on them. */}
      {punch.adminTouched && (
        <span className="text-xs text-muted">Entered or edited by the office</span>
      )}
    </span>
  );
}

/**
 * ONE form for add and edit (#635). Rendered inside an expanded row, or at the bottom
 * of the list with empty fields — same fields, same required note, same validation.
 * Two forms with the same rules drift apart; that's what put four senders in charge of
 * their own SMS opener (#599) and three fill doors in charge of their own ask
 * retirement (#600).
 *
 * Server-rendered, no client JS: Cancel is a plain link back to the row.
 */
function PunchForm({
  mode,
  punchId,
  day,
  inTime,
  outTime,
  outIsNextDay,
  draft,
}: {
  mode: "add" | "edit";
  punchId?: string;
  day: string;
  inTime?: string;
  outTime?: string | null;
  outIsNextDay?: boolean;
  draft: FormDraft | null;
}) {
  const anchor = mode === "edit" ? `#punch-${punchId}` : "#punch-new";
  /**
   * Whose refusal was this? (#780)
   *
   * One component renders both doors, and they refuse to different URLs — an add lands on
   * `?add=1&err=`, an edit on `?edit=<id>&err=` — but they share one draft cookie. The add form
   * has no `punchId` field and the edit form always does, so the submitted `punchId` says which
   * door the draft came from AND, for an edit, which row: an edit draft applies to its own row
   * and nothing else.
   *
   * Only one editor is ever open at a time here, so a leak across rows isn't reachable today.
   * Keyed anyway, because "unreachable" is a property of the current page layout and this is a
   * property of the draft.
   */
  const draftPunchId = draft?.get("punchId");
  const mine =
    draft && (mode === "edit" ? draftPunchId === punchId : draftPunchId === undefined)
      ? draft
      : null;
  return (
    <form
      action={mode === "edit" ? editMyPunch : addMyPunch}
      className="flex flex-col gap-3 border-t border-line px-4 py-3"
    >
      {mode === "edit" ? (
        <>
          <input type="hidden" name="punchId" value={punchId} />
          {/* No date field: a punch belongs to the day it started on, which is what
              buckets it into a pay period. The domain refuses a cross-midnight in-time
              (`day_moved`) rather than trusting this to be absent. */}
          <input type="hidden" name="punchDay" value={day} />
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor="new-day" className="text-sm text-muted">
            Day
          </label>
          <input
            id="new-day"
            name="punchDay"
            type="date"
            defaultValue={mine?.get("punchDay") ?? day}
            required
            className="min-h-[44px] rounded-card border border-line bg-card px-3 text-ink"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`in-${punchId ?? "new"}`} className="text-sm text-muted">
            In
          </label>
          <input
            id={`in-${punchId ?? "new"}`}
            name="inTime"
            type="time"
            defaultValue={mine?.get("inTime") ?? inTime}
            required
            className="min-h-[44px] rounded-card border border-line bg-card px-3 text-ink"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`out-${punchId ?? "new"}`} className="text-sm text-muted">
            Out <span className="text-muted">(blank leaves it running)</span>
          </label>
          <input
            id={`out-${punchId ?? "new"}`}
            name="outTime"
            type="time"
            defaultValue={mine?.get("outTime") ?? outTime ?? ""}
            className="min-h-[44px] rounded-card border border-line bg-card px-3 text-ink"
          />
        </div>
      </div>

      {/* NO "out is next day" control here (operator, 2026-08-01): BrewBoat doesn't run
          overnight, and the checkbox cost more confusion than the case is worth. A crew
          member who forgets to clock out simply leaves the punch open — it's excluded
          from their hours and surfaces on the admin bench's stale strip. The VALUE is
          still carried, so editing a punch the office entered as overnight doesn't
          silently collapse it into `out_before_in`. The admin bench keeps the control. */}
      <input
        type="hidden"
        name="outNextDay"
        value={mine?.get("outNextDay") ?? (outIsNextDay ? "1" : "")}
      />

      {/* Required, and the reason the trail is worth keeping. */}
      <div className="flex flex-col gap-1">
        <label htmlFor={`why-${punchId ?? "new"}`} className="text-sm text-muted">
          Reason
        </label>
        <input
          id={`why-${punchId ?? "new"}`}
          name="reason"
          type="text"
          // No default before #780: required, prose, and blanked on every refusal.
          defaultValue={mine?.get("reason") ?? ""}
          required
          className="min-h-[44px] rounded-card border border-line bg-card px-3 text-ink"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Disabled until something changes, and guards against navigating away from
            an unsaved edit — the same island #627's bench uses, not a second
            mechanism. Cancel is an anchor, which its capture-phase guard covers.
            **Untested on this surface, knowingly** (operator, 2026-08-02): the guard
            has e2e coverage on the admin bench and none here. Recorded rather than
            left silent, because the first cut of this island attached its listener to
            the button instead of the enclosing form — so it did nothing at all, and
            only a test caught it. If this stops warning, that's where to look. */}
        <DirtySubmit className="min-h-[44px] rounded-card bg-ok px-4 font-semibold text-white disabled:opacity-40">
          Save
        </DirtySubmit>
        <AppLink
          href={`/crew/time${anchor}`}
          prefetch={false}
          className="min-h-[44px] px-2 py-2 font-semibold text-ink"
        >
          Cancel
        </AppLink>
        {/* Delete shares the ONE reason field (operator, 2026-08-01) — only one action
            happens per submit, so a single "Reason" describes whatever you did to this
            punch. Two boxes would ask the reader to work out which belongs to which
            button, which is the confusion the next-day checkbox was removed for.
            `formAction` posts the same fields to a different action; with no JS it is
            still a plain second submit button. */}
        {mode === "edit" && (
          <SubmitButton
            formAction={deleteMyPunch}
            className="ml-auto min-h-[44px] rounded-card border border-bad px-4 font-semibold text-bad"
          >
            Delete
          </SubmitButton>
        )}
      </div>
    </form>
  );
}

/**
 * What the clock card shows while an editor is open.
 *
 * Clock in/out post their own forms, so pressing one mid-edit navigated away and threw
 * the edit out (operator, 2026-08-02). `DirtySubmit`'s guard couldn't catch it: it
 * covers anchors, `beforeunload` and the auto-submitting pickers, and **a submit button
 * belonging to a different form is none of those** — the same blind spot the #635
 * review found for the pickers, one surface over.
 *
 * Removed rather than guarded. The page already puts everything else inert while an
 * editor is open — the other punch rows, the Add button — so the clock following that
 * rule is the consistent answer, it needs no JS (a confirm dialog can't help a no-JS
 * user), and it makes losing the edit impossible instead of merely warned about.
 */
/** The clock buttons' one class rule: green means LIVE, not "this is Clock in" (#718). */
function clockBtn(live: boolean): string {
  return `min-h-[52px] w-full rounded-card font-semibold ${
    live ? "bg-ok text-white" : "border border-line bg-bg text-muted"
  }`;
}

function ClockBusy() {
  return (
    <p className="px-4 py-3 text-sm text-muted">
      Finish the punch you’re editing first.
    </p>
  );
}
