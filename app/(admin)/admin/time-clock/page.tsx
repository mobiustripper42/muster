import { AppLink } from "../../../../components/ui/app-link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { AutoSubmitDate, AutoSubmitSelect } from "../../../../components/admin/auto-submit-select";
import { DirtySubmit } from "../../../../components/admin/dirty-submit";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import {
  buildCrewPeriodView,
  buildDayView,
  staleOpenPunches,
  type PunchRow,
} from "@core/admin/time-clock-admin.js";
import { currentPeriod, periodsForYear, periodLabel } from "@core/admin/pay-periods.js";
import { PAY_PERIOD_ANCHOR, addDays, vesselDateOf } from "@core/config/tenant.js";
import { compactDuration } from "@core/admin/hours-format.js";
import { asId } from "@core/domain/ids.js";
import { fmt12, fmtDateRange } from "../../../lib/format";
import { notFound } from "next/navigation";
import { readSubject } from "../../../lib/auth";
import { errCopyFor } from "../../../lib/err-copy";
import { readFormDraft, type FormDraft } from "../../../lib/form-draft";
import { timeClockEnabled } from "../../../lib/flags";
import { getRepo } from "../../../lib/repo";
import { ADMIN_LOG_HINT, logSwallowed } from "../../../lib/swallowed";
import {
  addPunchAction,
  deletePunchAction,
  editPunchAction,
  type TimeClockErr,
} from "./actions";

/**
 * /admin/time-clock (#627, SPEC §2.9.5) — the operator's repair bench. Muster never
 * guesses when someone went home, so a missed clock-out is closed by a human here.
 *
 * **Two narrow views**, not a fleet grid: one crew × one pay period, or all crew ×
 * one day. Above both, a strip of every punch still open from an earlier day — that
 * one doesn't depend on picking the right crew or day, which is the only way the
 * forgotten clock-out is reliably findable.
 *
 * Server-rendered, no client JS: every form posts to a server action, and the delete
 * confirmation is a `<details>` disclosure rather than a JS confirm.
 */

export const dynamic = "force-dynamic";

type Search = {
  crew?: string;
  period?: string;
  day?: string;
  added?: string;
  saved?: string;
  deleted?: string;
  err?: string;
  // A refused add rides its attempted values back so nothing typed is lost. Shapes are
  // re-validated below before they're echoed into inputs — structured values, not prose.
  aday?: string;
  ain?: string;
  aout?: string;
  acrew?: string;
  anext?: string;
};

const ERR_COPY: Record<TimeClockErr, string> = {
  out_before_in: "The out time is at or before the in time — a punch can’t end before it starts.",
  already_in: "That person already has an open punch. Close it first.",
  day_moved:
    "That time would move the punch to a different day. Delete it and add it on the right day instead.",
  gone: "That punch no longer exists — someone may have deleted it.",
  bad_input: "Something was missing or malformed — check the fields and try again.",
  future: "That time hasn’t happened yet — a punch records work that’s already been done.",
  error: "Couldn’t save that just now — try again in a moment.",
};

const isDay = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function AdminTimeClock({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  // Phase dark (#628) — the route 404s, it does not merely lose its nav entry (#621).
  if (!timeClockEnabled()) notFound();

  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin")
    return <AdminSignedOut subject={subject} />;

  const today = vesselDateOf(new Date());
  const cur = currentPeriod(PAY_PERIOD_ANCHOR, today);
  const periods = periodsForYear(PAY_PERIOD_ANCHOR, Number(today.slice(0, 4)));

  const [selFrom, selTo] = (sp.period ?? "").split("|");
  const period = isDay(selFrom) && isDay(selTo) ? { start: selFrom, end: selTo } : cur;
  const periodValue = `${period.start}|${period.end}`;
  // The day view wins when ?day= is present and well-formed; otherwise the crew view.
  // Narrowed in one step so `day` is a plain string downstream — a separate boolean
  // wouldn't carry the type guard.
  const dayParam = isDay(sp.day) ? sp.day : null;
  const dayMode = dayParam !== null;
  const day = dayParam ?? today;

  let crewList: { id: string; name: string }[];
  let stale: Awaited<ReturnType<typeof staleOpenPunches>>;
  let crewView: Awaited<ReturnType<typeof buildCrewPeriodView>> | null = null;
  let dayView: Awaited<ReturnType<typeof buildDayView>> | null = null;
  try {
    const repo = getRepo();
    const members = await repo.listCrewMembers();
    crewList = members
      .filter((c) => c.status !== "archived")
      .map((c) => ({ id: String(c.id), name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const selectedCrew = sp.crew && crewList.some((c) => c.id === sp.crew) ? sp.crew : crewList[0]?.id;

    [stale, crewView, dayView] = await Promise.all([
      staleOpenPunches(repo, today),
      dayMode || !selectedCrew
        ? Promise.resolve(null)
        : buildCrewPeriodView(repo, asId<"CrewMemberId">(selectedCrew), period),
      dayMode ? buildDayView(repo, day) : Promise.resolve(null),
    ]);
  } catch (e) {
    logSwallowed("admin/time-clock", e, "the roster, stale punches and period/day views did not load");
    return (
      <Shell width="3xl">
        <Notice>Couldn’t load the time clock right now. {ADMIN_LOG_HINT}</Notice>
      </Shell>
    );
  }

  const errCopy = errCopyFor(ERR_COPY, sp.err, "error");
  // Re-validate every echoed value before it reaches an input — a crafted `?ain=`
  // must not put arbitrary text in a form on a trusted surface. Anything off-shape is
  // dropped, so the field falls back to empty rather than to whatever was in the URL.
  const isTime = (t?: string) => (t && /^\d{2}:\d{2}$/.test(t) ? t : "");
  const retry = {
    day: isDay(sp.aday) ? sp.aday : null,
    in: isTime(sp.ain),
    out: isTime(sp.aout),
    crew: sp.acrew && crewList.some((c) => c.id === sp.acrew) ? sp.acrew : null,
    next: sp.anext === "1",
  };
  const view = dayMode ? dayView : crewView;
  const rows: PunchRow[] = view?.rows ?? [];
  // A refused EDIT rides back as a draft (#780). The add form doesn't use this — it has its own
  // `retry` params above and predates the mechanism — but every other write on this surface
  // clears the draft, so what's here always belongs to the last refused edit and nothing else.
  const draft = sp.err ? await readFormDraft("/admin/time-clock") : null;
  // Carried on every write form so the redirect lands back on the same view.
  const context = dayMode
    ? { view: "day", day, crew: "", period: "" }
    : { view: "crew", day: "", crew: crewView?.crewMemberId ?? "", period: periodValue };

  return (
    <Shell width="3xl">
      <h1 className="text-xl font-semibold text-ink">Time clock</h1>

      {sp.added && <Notice tone="ok">Punch added.</Notice>}
      {sp.saved && <Notice tone="ok">Saved.</Notice>}
      {sp.deleted && <Notice tone="ok">Punch deleted.</Notice>}
      {errCopy && <Notice tone="bad">{errCopy}</Notice>}

      {/* The strip. Independent of both pickers — a punch open since three days ago
          belongs to neither the selected crew nor the selected day, and it is exactly
          the thing this page exists for (§2.9.5). */}
      {stale.length > 0 && (
        <section className="flex flex-col gap-2 rounded-card border border-bad bg-card px-4 py-3 shadow-sm">
          <h2 className="text-sm font-semibold text-bad">
            {stale.length} punch{stale.length === 1 ? "" : "es"} still open from an earlier day
          </h2>
          <p className="text-xs text-muted">
            Nobody is on the clock this long. These don’t count toward anyone’s hours
            until they’re closed.
          </p>
          <ul className="flex flex-col gap-1">
            {stale.map((s) => (
              <li key={s.id} className="text-sm text-ink">
                <AppLink href={`/admin/time-clock?day=${s.day}`} className="underline">
                  {s.crewName ?? "(unknown crew)"} — in at {fmt12(s.inTime)} on{" "}
                  {fmtDateRange(s.day, s.day)}
                </AppLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* TABS, not two competing picker forms. Which view you're in has to be
          unmistakable before the controls under it mean anything — the crew-name ·
          date caption alone wasn't enough to tell them apart (operator, 2026-08-01).
          Plain links: the selected tab is a <span>, so it isn't a control that
          re-navigates to where you already are. */}
      <div role="tablist" aria-label="Time clock view" className="flex gap-1 border-b border-line">
        {dayMode ? (
          <>
            <AppLink
              href={`/admin/time-clock?crew=${crewList[0]?.id ?? ""}&period=${periodValue}`}
              className="rounded-t-card px-4 py-2 font-semibold text-muted hover:text-ink"
            >
              By crew
            </AppLink>
            <span
              role="tab"
              aria-selected="true"
              className="rounded-t-card border-b-2 border-accent px-4 py-2 font-semibold text-ink"
            >
              By day
            </span>
          </>
        ) : (
          <>
            <span
              role="tab"
              aria-selected="true"
              className="rounded-t-card border-b-2 border-accent px-4 py-2 font-semibold text-ink"
            >
              By crew
            </span>
            <AppLink
              href={`/admin/time-clock?day=${today}`}
              className="rounded-t-card px-4 py-2 font-semibold text-muted hover:text-ink"
            >
              By day
            </AppLink>
          </>
        )}
      </div>

      {/* The selected view's controls. Both selects navigate on change — no View
          button to press (the CrewSelect idiom, DEC-042 amendment). */}
      <div className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-sm">
        {dayMode ? (
          <>
            {/* Day nav: one step back, a picker, one step forward. The steps are plain
                links — no JS, and they're what you actually reach for when walking a
                weekend. Starts at today (§the tab link above). */}
            <AppLink
              href={`/admin/time-clock?day=${addDays(day, -1)}`}
              aria-label="Previous day"
              className="min-h-[44px] rounded-card border border-line px-4 py-2 font-semibold text-ink"
            >
              ‹
            </AppLink>
            <form method="get" className="flex flex-col gap-1">
              <label htmlFor="day" className="text-xs text-muted">
                Day
              </label>
              <AutoSubmitDate
                id="day"
                name="day"
                value={day}
                ariaLabel="Day"
                className="min-h-[44px] rounded-card border border-line bg-card px-3 text-ink"
              />
            </form>
            <AppLink
              href={`/admin/time-clock?day=${addDays(day, 1)}`}
              aria-label="Next day"
              className="min-h-[44px] rounded-card border border-line px-4 py-2 font-semibold text-ink"
            >
              ›
            </AppLink>
            {day !== today && (
              <AppLink
                href={`/admin/time-clock?day=${today}`}
                className="min-h-[44px] px-2 py-2 text-sm text-accent underline"
              >
                Today
              </AppLink>
            )}
          </>
        ) : (
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="crew" className="text-xs text-muted">
                Crew member
              </label>
              <AutoSubmitSelect
                name="crew"
                value={String(crewView?.crewMemberId ?? "")}
                options={crewList.map((c) => ({ value: c.id, label: c.name }))}
                ariaLabel="Crew member"
                className="min-h-[44px] rounded-card border border-line bg-card px-3 text-ink"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="period" className="text-xs text-muted">
                Pay period
              </label>
              <AutoSubmitSelect
                name="period"
                value={periodValue}
                options={periods.map((p) => ({
                  value: `${p.start}|${p.end}`,
                  label: `${periodLabel(p)}${p.start === cur.start ? " — current" : ""}`,
                }))}
                ariaLabel="Pay period"
                className="min-h-[44px] rounded-card border border-line bg-card px-3 text-ink"
              />
            </div>
          </form>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {dayMode
            ? `${fmtDateRange(day, day)} · all crew`
            : `${crewView?.crewName ?? "—"} · ${periodLabel(period)}`}
        </h2>

        {rows.length === 0 ? (
          <Notice>No punches here.</Notice>
        ) : (
          rows.map((r) => (
            <PunchCard key={r.id} row={r} showName={dayMode} context={context} draft={draft} />
          ))
        )}

        {rows.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <span className="font-semibold text-ink">
              Total
            </span>
            <span className="font-mono font-semibold text-ink">
              {compactDuration(view?.totalMinutes ?? 0)}
            </span>
          </div>
        )}
      </section>

      <AddPunchForm
        context={context}
        crewList={crewList}
        dayMode={dayMode}
        day={day}
        period={period}
        retry={retry}
      />
    </Shell>
  );
}

type Context = { view: string; day: string; crew: string; period: string };

/** The hidden fields that put a redirect back where the operator was. */
function ContextFields({ context }: { context: Context }) {
  return (
    <>
      <input type="hidden" name="view" value={context.view} />
      <input type="hidden" name="day" value={context.day} />
      <input type="hidden" name="crew" value={String(context.crew)} />
      <input type="hidden" name="period" value={context.period} />
    </>
  );
}

function PunchCard({
  row,
  showName,
  context,
  draft,
}: {
  row: PunchRow;
  showName: boolean;
  context: Context;
  draft: FormDraft | null;
}) {
  /**
   * The draft belongs to ONE punch, and this component renders once per row (#780).
   *
   * Applying a surface-wide draft to every card would repopulate the whole bench with one row's
   * submitted values — which is #699's "shows you another record" defect arriving through the
   * mechanism built to stop it, and on a surface whose output is a paycheck. `punchId` is
   * already a hidden field on this form, so the submitted draft says which row it came from and
   * every other card falls through to its own stored values.
   */
  const mine = draft && draft.get("punchId") === row.id ? draft : null;
  return (
    <div
      // A countable hook for the bench's rows. Same reasoning as `data-active` on the admin nav:
      // a test that has to infer "how many punches are on screen" from a class string is a test
      // that breaks on a styling change. `payroll-reconcile.spec.ts` waits on this count after
      // each Add, because the redirect URL cannot tell two consecutive adds apart.
      data-punch-row={row.id}
      className={`flex flex-col gap-2 rounded-card border bg-card px-4 py-3 shadow-sm ${
        row.open ? "border-bad" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-ink">
          {showName ? row.crewName ?? "(unknown crew)" : fmtDateRange(row.day, row.day)}
          {showName && (
            <span className="ml-2 text-sm font-normal text-muted">
              {fmtDateRange(row.day, row.day)}
            </span>
          )}
        </span>
        <span className="font-mono text-sm text-ink">
          {/* Same words as /crew/time for the same state — one punch must not read
              two ways depending on who's looking at it. */}
          {row.minutes === null ? "still on the clock" : compactDuration(row.minutes)}
        </span>
      </div>

      {/* Provenance (§2.9.8) — hours nobody tapped must never read as hours they did. */}
      {(row.enteredByAdmin || row.editedByAdmin) && (
        <span className="text-xs text-muted">
          {row.enteredByAdmin ? "Entered by the office" : "Edited by the office"}
        </span>
      )}

      {/* Edit: times only. There is deliberately NO date field — a punch belongs to the
          day it started on, which is what its shift match and pay period key off. The
          domain refuses a cross-midnight in-time anyway (`day_moved`). */}
      <form action={editPunchAction} className="flex flex-wrap items-end gap-2">
        <ContextFields context={context} />
        <input type="hidden" name="punchId" value={row.id} />
        <input type="hidden" name="punchDay" value={row.day} />
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted" htmlFor={`in-${row.id}`}>
            In
          </label>
          <input
            id={`in-${row.id}`}
            name="inTime"
            type="time"
            defaultValue={mine?.get("inTime") ?? row.inTime}
            required
            className="min-h-[44px] rounded-card border border-line bg-card px-3 text-ink"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted" htmlFor={`out-${row.id}`}>
            Out
          </label>
          <input
            id={`out-${row.id}`}
            name="outTime"
            type="time"
            defaultValue={mine?.get("outTime") ?? row.outTime ?? ""}
            className="min-h-[44px] rounded-card border border-line bg-card px-3 text-ink"
          />
        </div>
        {/* An evening trip that lands after midnight is ONE punch on the earlier day
            (§2.9.6), so the out time needs to be able to say "next day". Explicit, not
            inferred from out < in — that would turn a typo into a paid 16 hours. */}
        <label className="flex items-center gap-2 pb-2 text-xs text-muted">
          <input
            type="checkbox"
            name="outNextDay"
            value="1"
            // `has`, never `??`: an unticked box posts nothing, and that nothing is the
            // operator's answer. Falling back to the stored value here would silently re-tick
            // the box they had just cleared — on a form that decides how many hours get paid.
            defaultChecked={mine ? mine.has("outNextDay") : row.outIsNextDay}
            className="h-5 w-5"
          />
          Out is next day
        </label>
        {/* Disabled until something in this row actually changes — a column of live
            Save buttons on rows you're only reading is noise. */}
        <DirtySubmit className="min-h-[44px] rounded-card bg-accent px-4 font-semibold text-white disabled:opacity-40">
          Save
        </DirtySubmit>
      </form>

      {/* Delete behind a disclosure — no-JS confirmation. The copy states it's real
          deletion BEFORE the button is reachable (#627 AC). */}
      <details>
        <summary className="cursor-pointer text-xs text-muted">Delete this punch</summary>
        <form action={deletePunchAction} className="mt-2 flex flex-wrap items-center gap-3">
          <ContextFields context={context} />
          <input type="hidden" name="punchId" value={row.id} />
          <SubmitButton className="min-h-[44px] rounded-card border border-bad px-4 font-semibold text-bad">
            Delete
          </SubmitButton>
        </form>
      </details>
    </div>
  );
}

function AddPunchForm({
  context,
  crewList,
  dayMode,
  day,
  period,
  retry,
}: {
  context: Context;
  crewList: { id: string; name: string }[];
  dayMode: boolean;
  day: string;
  period: { start: string; end: string };
  /** What was attempted on a refused add — re-filled so a rejection costs one field,
   *  not three. Already shape-validated by the caller. */
  retry: { day: string | null; in: string; out: string; crew: string | null; next: boolean };
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
        Add a punch
      </h2>
      <form
        action={addPunchAction}
        className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-sm"
      >
        <ContextFields context={context} />
        {/* One picker or the other — in the day view the day is fixed and you choose a
            person; in the crew view the person is fixed and you choose a day. Neither
            form ever asks for both. */}
        {dayMode ? (
          <>
            <input type="hidden" name="punchDay" value={day} />
            <div className="flex flex-col gap-1">
              <label htmlFor="add-crew" className="text-xs text-muted">
                Crew member
              </label>
              <select
                id="add-crew"
                name="crewMemberId"
                defaultValue={retry.crew ?? undefined}
                className="min-h-[44px] rounded-card border border-line bg-card px-3 text-ink"
              >
                {crewList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            <input type="hidden" name="crewMemberId" value={String(context.crew)} />
            <div className="flex flex-col gap-1">
              <label htmlFor="add-day" className="text-xs text-muted">
                Day
              </label>
              <input
                id="add-day"
                name="punchDay"
                type="date"
                defaultValue={retry.day ?? period.start}
                min={period.start}
                max={period.end}
                required
                className="min-h-[44px] rounded-card border border-line bg-card px-3 text-ink"
              />
            </div>
          </>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="add-in" className="text-xs text-muted">
            In
          </label>
          <input
            id="add-in"
            name="inTime"
            type="time"
            defaultValue={retry.in}
            required
            className="min-h-[44px] rounded-card border border-line bg-card px-3 text-ink"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="add-out" className="text-xs text-muted">
            Out <span className="text-muted">(blank leaves it running)</span>
          </label>
          <input
            id="add-out"
            name="outTime"
            type="time"
            defaultValue={retry.out}
            className="min-h-[44px] rounded-card border border-line bg-card px-3 text-ink"
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted">
          <input
            type="checkbox"
            name="outNextDay"
            value="1"
            defaultChecked={retry.next}
            className="h-5 w-5"
          />
          Out is next day
        </label>
        <SubmitButton className="min-h-[44px] rounded-card bg-accent px-4 font-semibold text-white">
          Add
        </SubmitButton>
      </form>
    </section>
  );
}
