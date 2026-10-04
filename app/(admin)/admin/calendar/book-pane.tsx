import type { Offering } from "@core/domain/entities.js";
import { checkoutQuote } from "@core/reservations/checkout-quote.js";
import type { PaymentConfig } from "@core/reservations/payment-config.js";
import { settingsInputClass } from "../../../../components/admin/settings-field";
import { AppLink } from "../../../../components/ui/app-link";
import { GetFormSubmit } from "../../../../components/ui/get-form-submit";
import { Notice } from "../../../../components/ui/notice";
import { errCopyFor } from "../../../lib/err-copy";
import { readFormDraft } from "../../../lib/form-draft";
import { getRepo } from "../../../lib/repo";
import { ADMIN_LOG_HINT, logSwallowed } from "../../../lib/swallowed";
import type { BookErr } from "./book-actions";
import { SlotHeader, bookHref, calendarHref, type CalendarData } from "./calendar-view";
import { PhoneBookingForm } from "./phone-booking-form";

/**
 * Book by phone, in the calendar's pane (16.1, 16.1d, SPEC §2.10.6; issue #1104 part 3).
 *
 * Someone rings up, the operator clicks the open card, taps **Book it**, and the slot pane turns
 * into the booking — with the calendar still beside it. It used to be a page of its own
 * (`/admin/calendar/book`), which took the operator off the calendar mid-call; the pane was already
 * the right width.
 *
 * Two steps, the same two a customer takes: **how many**, then **the checkout** — the public
 * checkout's own contact fields, tip tiles, money summary and pay bar (`components/checkout/`,
 * issue #1092), priced by the same `checkoutQuote` on the boat the operator clicked. It writes an
 * unpaid booking that holds the boat until the customer pays or a person cancels it (DEC-163), and
 * the pane becomes that booking's.
 *
 * **Passengers first because the money depends on them** — extras, and every percentage built on
 * the fare. The calendar has already chosen the boat and the time, so the count is the only thing
 * left to ask. A plain GET, so it works without JS like the rest of the calendar (DEC-026); the
 * checkout step is a client island only because tip tiles re-total live.
 *
 * **No card field, ever** (DEC-162). **No terms box:** the customer ticks it on the payment link
 * (issue #1082, DEC-188), not the operator on the phone.
 */

/** The booking steps' own params, on top of the calendar's. */
export type BookSearch = {
  /** `1` ⇒ the open slot's pane shows the booking steps instead of Book it / Block it. */
  book?: string;
  offering?: string;
  /** Selects the checkout step, for this party. */
  guests?: string;
  /** Prefills the passengers step, from the checkout's Change link. */
  party?: string;
  /** A refused booking's reason. Not `err`, which is the calendar's block/unblock banner. */
  bookErr?: string;
};

const ERR_COPY: Record<BookErr, string> = {
  name_required: "Enter the guest’s name.",
  phone_invalid: "That mobile number doesn’t look right — a 10-digit US number, or + and a country code.",
  gratuity_required: "Pick a crew tip.",
  offering_missing: "That cruise isn’t in the catalog anymore.",
  not_live: "That cruise isn’t live — publish it before booking it.",
  invalid_guest_count: "Enter how many guests, 1 or more.",
  off_schedule: "That date or time isn’t valid.",
  departed: "That departure has already left.",
  // Unreachable: the operator passes the booking cutoff (DEC-193). Here because the map is total.
  cutoff: "That departure is inside the booking cutoff.",
  over_capacity: "That’s more guests than this boat is certified for.",
  vessel_not_offered: "That cruise doesn’t run on this boat.",
  blocked: "This departure is blocked. Unblock it on the calendar first, then book it.",
  busy: "The boat is out on another trip then, or a customer is checking out for it right now.",
  unreachable: "Couldn’t save that just now — nothing was booked. Try again in a moment.",
};

/** The cookie the refused booking's draft is stashed under (`book-actions.ts`). */
const SURFACE = "/admin/calendar";

export async function BookPane({ data, sp }: { data: CalendarData; sp: BookSearch }) {
  const p = data.pending;
  // The page only renders this for an OPEN slot's pane; anything else has nothing to book.
  if (!p || p.action !== "hold") return null;

  const vessel = data.vesselById.get(p.vesselId);
  // What is open at this boat-time, per offering — the same slots the calendar drew. Anything
  // else (blocked, sold, mid-checkout, departed) is not bookable, and the write would refuse it.
  const choices = data.slots
    .filter((s) => String(s.vesselId) === p.vesselId && s.time === p.time && s.status === "available")
    .map((s) => data.offeringById.get(String(s.offeringId)))
    .filter((o): o is Offering => o !== undefined);
  if (!vessel || choices.length === 0) {
    return (
      <Notice>
        That departure isn’t open to book anymore — someone may have just taken it. The calendar
        shows what’s free.
      </Notice>
    );
  }

  let config: PaymentConfig;
  try {
    config = await getRepo().getPaymentConfig();
  } catch (e) {
    logSwallowed("admin/calendar:book", e, "the payment config did not load");
    return <Notice>Couldn’t load this departure’s prices right now. {ADMIN_LOG_HINT}</Notice>;
  }

  // The refused booking's draft — only when it is this physical slot's: boat, day and time (a boat
  // runs the same clock time every day). The cookie is the calendar's, and the reservation pane's
  // refund draft shares it (`book-actions.ts`).
  const rawDraft = sp.bookErr ? await readFormDraft(SURFACE) : null;
  const draft =
    rawDraft &&
    rawDraft.get("vesselId") === p.vesselId &&
    rawDraft.get("date") === data.day &&
    rawDraft.get("time") === p.time
      ? rawDraft
      : null;

  const offering =
    choices.find((o) => String(o.id) === (draft?.get("offeringId") ?? sp.offering)) ?? choices[0]!;
  const cap = vessel.coiMaxPax;
  const guests = Number(sp.guests);
  const guestsOk = sp.guests !== undefined && Number.isInteger(guests) && guests >= 1 && guests <= cap;
  // A count that came in and could not be used is said on the passengers step, not dropped.
  let guestsErr: string | null = null;
  if (sp.guests !== undefined && !guestsOk) {
    guestsErr =
      Number.isInteger(guests) && guests > cap
        ? `${vessel.name} takes ${cap} guests at most. A bigger party needs a bigger boat — pick one on the calendar.`
        : "Enter how many guests, 1 or more.";
  }

  return (
    <div data-testid="book-pane" className="flex flex-col gap-3">
      <SlotHeader data={data} p={p} />
      {guestsOk ? (
        <CheckoutStep data={data} p={p} offering={offering} guests={guests} config={config} sp={sp} draft={draft} />
      ) : (
        <PassengersStep data={data} p={p} offering={offering} choices={choices} cap={cap} sp={sp} guestsErr={guestsErr} />
      )}
    </div>
  );
}

type Pending = NonNullable<CalendarData["pending"]>;

function PassengersStep({
  data,
  p,
  offering,
  choices,
  cap,
  sp,
  guestsErr,
}: {
  data: CalendarData;
  p: Pending;
  offering: Offering;
  choices: Offering[];
  cap: number;
  sp: BookSearch;
  guestsErr: string | null;
}) {
  const input = `${settingsInputClass} w-full`;
  return (
    <>
      {guestsErr ? <Notice tone="bad">{guestsErr}</Notice> : null}
      {/* GET back to the calendar: the count selects the checkout step. No write happens here. */}
      <form method="get" action="/admin/calendar" className="flex flex-col gap-3">
        <input type="hidden" name="date" value={data.day} />
        {data.filter !== "all" ? <input type="hidden" name="filter" value={data.filter} /> : null}
        {data.view === "list" ? <input type="hidden" name="view" value="list" /> : null}
        <input type="hidden" name="hold" value={`${p.vesselId}|${p.time}`} />
        <input type="hidden" name="book" value="1" />
        <div className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-3">
          {choices.length > 1 ? (
            <label className="flex flex-col gap-1 text-xs font-medium text-ink">
              Cruise
              <select name="offering" defaultValue={String(offering.id)} className={input}>
                {choices.map((o) => (
                  <option key={String(o.id)} value={String(o.id)}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <input type="hidden" name="offering" value={String(offering.id)} />
              <span className="text-muted">Cruise</span>
              <span className="text-right text-ink">{offering.name}</span>
            </div>
          )}
          <label className="flex flex-col gap-1 text-xs font-medium text-ink">
            <span>
              Guests <span className="font-normal text-muted">· this boat takes {cap}</span>
            </span>
            <input
              name="guests"
              type="number"
              inputMode="numeric"
              min={1}
              max={cap}
              required
              defaultValue={sp.party ?? ""}
              className={input}
            />
          </label>
        </div>
        <div className="flex gap-3">
          <GetFormSubmit className="btn-primary flex-1">Continue</GetFormSubmit>
          {/* Back to the slot's own pane — Book it / Block it again. Nothing was written. */}
          <AppLink href={calendarHref(data, { hold: `${p.vesselId}|${p.time}` })} className="btn-secondary flex-1">
            Cancel
          </AppLink>
        </div>
      </form>
    </>
  );
}

function CheckoutStep({
  data,
  p,
  offering,
  guests,
  config,
  sp,
  draft,
}: {
  data: CalendarData;
  p: Pending;
  offering: Offering;
  guests: number;
  config: PaymentConfig;
  sp: BookSearch;
  draft: Awaited<ReturnType<typeof readFormDraft>>;
}) {
  const vessel = data.vesselById.get(p.vesselId)!;
  const quote = checkoutQuote({
    offering,
    vessel,
    vesselId: vessel.id,
    events: data.events,
    config,
    date: data.day,
    time: p.time,
    guestCount: guests,
  });
  const { tiers, defaultBps, ...money } = quote;
  const changeHref = bookHref(data, p, { offering: String(offering.id), party: String(guests) });
  const error = errCopyFor(ERR_COPY, sp.bookErr, "unreachable");
  const draftTip = Number(draft?.get("gratuityBps"));

  return (
    <>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div className="flex flex-col rounded-card border border-line bg-card">
        {/* The trip, changeable — the public checkout's "Your trip" row. */}
        <div className="px-4 pt-4">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-muted">Their trip</div>
          <div className="flex items-center gap-2.5 rounded-xl border border-line px-3.5 py-3">
            <span className="min-w-0 flex-1 text-sm">
              <b className="font-semibold">{offering.name}</b>
              <span className="text-muted">
                {" "}
                · {guests} {guests === 1 ? "guest" : "guests"}
              </span>
            </span>
            <AppLink href={changeHref} className="btn-quiet text-xs">
              Change
            </AppLink>
          </div>
        </div>

        <PhoneBookingForm
          slot={{ date: data.day, time: p.time, vesselId: p.vesselId, offeringId: String(offering.id), guests, view: data.view }}
          money={money}
          tiers={tiers}
          initial={{
            name: draft?.get("customerName") ?? "",
            phone: draft?.get("phone") ?? "",
            email: draft?.get("email") ?? "",
            gratuityBps: Number.isInteger(draftTip) && draftTip > 0 ? draftTip : defaultBps,
          }}
          restored={draft !== null}
        />
      </div>
    </>
  );
}
