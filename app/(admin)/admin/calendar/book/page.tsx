import type { Block, Event, Offering, Reservation, Vessel } from "@core/domain/entities.js";
import { deriveVirtualAvailability } from "@core/reservations/availability.js";
import { checkoutQuote } from "@core/reservations/checkout-quote.js";
import type { PaymentConfig } from "@core/reservations/payment-config.js";
import { settingsInputClass } from "../../../../../components/admin/settings-field";
import { AdminSignedOut } from "../../../../../components/admin/admin-signed-out";
import { AppLink } from "../../../../../components/ui/app-link";
import { BackLink } from "../../../../../components/ui/back-link";
import { GetFormSubmit } from "../../../../../components/ui/get-form-submit";
import { Notice } from "../../../../../components/ui/notice";
import { Shell } from "../../../../../components/ui/shell";
import { VersionTag } from "../../../../../components/ui/version-tag";
import { readSubject } from "../../../../lib/auth";
import { errCopyFor } from "../../../../lib/err-copy";
import { readFormDraft } from "../../../../lib/form-draft";
import { getRepo } from "../../../../lib/repo";
import { ADMIN_LOG_HINT, logSwallowed } from "../../../../lib/swallowed";
import { clockTime, formatFullDay } from "../calendar-view";
import type { BookErr } from "./actions";
import { PhoneBookingForm } from "./phone-booking-form";

/**
 * /admin/calendar/book (16.1, 16.1d, SPEC §2.10.6) — someone rings up, and the operator books them.
 *
 * Reached from the calendar's confirm banner, which names one boat and one time. Two steps, the
 * same two a customer takes: **how many**, then **the checkout** — the public checkout's own
 * contact fields, tip tiles, money summary and pay bar (`components/checkout/`, issue #1092),
 * priced by the same `checkoutQuote` on the boat the operator clicked. It writes an unpaid booking
 * that holds the boat until the customer pays or a person cancels it (DEC-163).
 *
 * **Passengers first because the money depends on them** — extras, and every percentage built on
 * the fare. The public funnel gets the count from `/book` before checkout; here the calendar has
 * already chosen the boat and the time, so the count is the only thing left to ask. A plain GET,
 * so it works without JS like the rest of the calendar (DEC-026); the checkout step is a client
 * island only because tip tiles re-total live.
 *
 * **No card field, ever** (DEC-162). **No waiver box:** phone orders collect none (2026-09-23).
 */

export const dynamic = "force-dynamic";

type Search = {
  date?: string;
  vessel?: string;
  time?: string;
  offering?: string;
  /** Selects the checkout step, for this party. */
  guests?: string;
  /** Prefills the passengers step, from the checkout's Change link. */
  party?: string;
  err?: string;
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
  over_capacity: "That’s more guests than this boat is certified for.",
  vessel_not_offered: "That cruise doesn’t run on this boat.",
  blocked: "This departure is blocked. Unblock it on the calendar first, then book it.",
  busy: "The boat is out on another trip then, or a customer is checking out for it right now.",
  unreachable: "Couldn’t save that just now — nothing was booked. Try again in a moment.",
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;
const SURFACE = "/admin/calendar/book";

export default async function BookPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  const date = sp.date && ISO_DAY.test(sp.date) ? sp.date : "";
  const time = sp.time && HHMM.test(sp.time) ? sp.time : "";
  const vesselId = sp.vessel ?? "";
  const back = `/admin/calendar${date ? `?date=${date}` : ""}`;

  let offerings: Offering[];
  let vessels: Vessel[];
  let blocks: Block[];
  let events: Event[];
  let reservations: Reservation[];
  let config: PaymentConfig;
  try {
    const repo = getRepo();
    [offerings, vessels, blocks, events, reservations, config] = await Promise.all([
      repo.listOfferings(),
      repo.listVessels(),
      repo.listBlocks(),
      repo.listEvents(),
      repo.listAllReservations(),
      repo.getPaymentConfig(),
    ]);
  } catch (e) {
    logSwallowed("admin/calendar/book", e, "the booking page did not load");
    return (
      <Shell width="md">
        <Notice>Couldn’t load this departure right now. {ADMIN_LOG_HINT}</Notice>
      </Shell>
    );
  }

  const vessel = vessels.find((v) => String(v.id) === vesselId);
  // What is actually open at this boat-time right now, per offering — the same deriver the
  // calendar draws from. Anything else — blocked, sold, mid-checkout, departed, the hull busy —
  // is not bookable here, and the write would refuse it anyway. A block in particular is lifted
  // on the calendar first (§2.10.6): booking through one takes that deliberate second step.
  const slots =
    date && time && vessel
      ? deriveVirtualAvailability({
          offerings,
          vessels,
          dateRange: { start: date, end: date },
          blocks,
          events,
          reservations,
          asOf: new Date().toISOString(),
        }).filter((s) => String(s.vesselId) === vesselId && s.time === time && s.status === "available")
      : [];
  const choices = slots
    .map((s) => offerings.find((o) => String(o.id) === String(s.offeringId)))
    .filter((o): o is Offering => o !== undefined);

  if (!vessel || choices.length === 0) {
    return (
      <Shell width="md">
        <BackLink href={back}>Back to calendar</BackLink>
        <Notice>
          That departure isn’t open to book anymore — someone may have just taken it. The calendar
          shows what’s free.
        </Notice>
      </Shell>
    );
  }

  const draft = sp.err ? await readFormDraft(SURFACE) : null;
  const offering = choices.find((o) => String(o.id) === (draft?.get("offeringId") ?? sp.offering)) ?? choices[0]!;
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

  const slotQuery = { date, vessel: String(vessel.id), time };
  const header = (
    <>
      <BackLink href={back}>Back to calendar</BackLink>
      <header className="flex flex-col gap-1">
        <p className="text-xs text-muted">Calendar / Book by phone</p>
        <h1 className="text-[22px] font-semibold leading-tight text-ink">
          {clockTime(time)} on {vessel.name}
        </h1>
        <p className="text-sm text-muted">{formatFullDay(date)}</p>
      </header>
    </>
  );

  if (!guestsOk) {
    const input = `${settingsInputClass} w-full`;
    return (
      <Shell width="md">
        {header}
        {guestsErr ? <Notice tone="bad">{guestsErr}</Notice> : null}
        {/* GET back to this page: the count selects the checkout step. No write happens here. */}
        <form method="get" action={SURFACE} className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-3">
          <input type="hidden" name="date" value={slotQuery.date} />
          <input type="hidden" name="vessel" value={slotQuery.vessel} />
          <input type="hidden" name="time" value={slotQuery.time} />
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
            <>
              <input type="hidden" name="offering" value={String(offering.id)} />
              <p className="text-sm text-ink">{offering.name}</p>
            </>
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
          <GetFormSubmit className="btn-primary w-full">
            Continue
          </GetFormSubmit>
        </form>
        <VersionTag />
      </Shell>
    );
  }

  const quote = checkoutQuote({
    offering,
    vessel,
    vesselId: vessel.id,
    events,
    config,
    date,
    time,
    guestCount: guests,
  });
  const { tiers, defaultBps, ...money } = quote;
  const changeHref = `${SURFACE}?${new URLSearchParams({ ...slotQuery, offering: String(offering.id), party: String(guests) }).toString()}`;
  const error = errCopyFor(ERR_COPY, sp.err, "unreachable");
  const draftTip = Number(draft?.get("gratuityBps"));

  return (
    <Shell width="md">
      {header}
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
          slot={{ ...slotQuery, vesselId: slotQuery.vessel, offeringId: String(offering.id), guests }}
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

      <VersionTag />
    </Shell>
  );
}
