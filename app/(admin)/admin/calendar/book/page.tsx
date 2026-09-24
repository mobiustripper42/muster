import type { Block, Event, Offering, Reservation, Vessel } from "@core/domain/entities.js";
import { deriveVirtualAvailability, resolveBasePrice } from "@core/reservations/availability.js";
import { effectiveIncludedGuests, GRATUITY_DEFAULT_BPS, gratuityTiersFor } from "@core/reservations/pricing.js";
import { settingsInputClass } from "../../../../../components/admin/settings-field";
import { AdminSignedOut } from "../../../../../components/admin/admin-signed-out";
import { BackLink } from "../../../../../components/ui/back-link";
import { Notice } from "../../../../../components/ui/notice";
import { Shell } from "../../../../../components/ui/shell";
import { SubmitButton } from "../../../../../components/ui/submit-button";
import { VersionTag } from "../../../../../components/ui/version-tag";
import { readSubject } from "../../../../lib/auth";
import { errCopyFor } from "../../../../lib/err-copy";
import { readFormDraft } from "../../../../lib/form-draft";
import { getRepo } from "../../../../lib/repo";
import { ADMIN_LOG_HINT, logSwallowed } from "../../../../lib/swallowed";
import { clockTime, formatFullDay } from "../calendar-view";
import { bookPhoneReservation, type BookErr } from "./actions";

/**
 * /admin/calendar/book (16.1, SPEC §2.10.6) — someone rings up, and the operator books them.
 *
 * Reached from the calendar's confirm banner, which names one boat and one time. Collects what
 * public checkout collects — name, phone, email, party size, tip — and writes an unpaid booking
 * that holds the boat until the customer pays or a person cancels it (DEC-163).
 *
 * **No card field, ever** (DEC-162). **No waiver box:** consent is the customer's to give, so it
 * is taken where they pay. Server-rendered and no-JS like the rest of the calendar (DEC-026).
 */

export const dynamic = "force-dynamic";

type Search = {
  date?: string;
  vessel?: string;
  time?: string;
  offering?: string;
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

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  try {
    const repo = getRepo();
    [offerings, vessels, blocks, events, reservations] = await Promise.all([
      repo.listOfferings(),
      repo.listVessels(),
      repo.listBlocks(),
      repo.listEvents(),
      repo.listAllReservations(),
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
        }).filter(
          (s) =>
            String(s.vesselId) === vesselId &&
            s.time === time &&
            s.status === "available",
        )
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

  const draft = sp.err ? await readFormDraft("/admin/calendar/book") : null;
  const offering = choices.find((o) => String(o.id) === (draft?.get("offeringId") ?? sp.offering)) ?? choices[0]!;
  const tiers = gratuityTiersFor(offering);
  const tipDefault = draft?.get("gratuityBps") ?? String(tiers.includes(GRATUITY_DEFAULT_BPS) ? GRATUITY_DEFAULT_BPS : tiers[0]);
  const included = effectiveIncludedGuests(offering, vessel);
  const error = errCopyFor(ERR_COPY, sp.err, "unreachable");
  const input = `${settingsInputClass} w-full`;

  return (
    <Shell width="md">
      <BackLink href={back}>Back to calendar</BackLink>

      <header className="flex flex-col gap-1">
        <p className="text-xs text-muted">Calendar / Book by phone</p>
        <h1 className="text-[22px] font-semibold leading-tight text-ink">
          {clockTime(time)} on {vessel.name}
        </h1>
        <p className="text-sm text-muted">{formatFullDay(date)}</p>
      </header>

      {error ? <Notice tone="bad">{error}</Notice> : null}

      <form action={bookPhoneReservation} className="mt-2 flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-3">
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="time" value={time} />
        <input type="hidden" name="vesselId" value={String(vessel.id)} />

        {choices.length > 1 ? (
          <label className="flex flex-col gap-1 text-xs font-medium text-ink">
            Cruise
            <select name="offeringId" defaultValue={String(offering.id)} className={input}>
              {choices.map((o) => (
                <option key={String(o.id)} value={String(o.id)}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <input type="hidden" name="offeringId" value={String(offering.id)} />
            <p className="text-sm text-ink">{offering.name}</p>
          </>
        )}
        <p className="text-xs text-muted">
          {dollars(resolveBasePrice(offering, date))} for up to {included} guest{included === 1 ? "" : "s"}
          {offering.extraGuestPriceCents > 0 ? `, ${dollars(offering.extraGuestPriceCents)} each after that` : ""}.
          Tax, service fee and tip are added the same as online.
        </p>

        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          Guest’s full name
          <input name="customerName" required autoComplete="off" defaultValue={draft?.get("customerName") ?? ""} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          Mobile number
          <input name="phone" type="tel" required autoComplete="off" defaultValue={draft?.get("phone") ?? ""} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          <span>
            Email <span className="font-normal text-muted">· optional</span>
          </span>
          <input name="email" type="email" autoComplete="off" defaultValue={draft?.get("email") ?? ""} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          <span>
            Guests <span className="font-normal text-muted">· this boat takes {vessel.coiMaxPax}</span>
          </span>
          <input
            name="guests"
            type="number"
            inputMode="numeric"
            min={1}
            max={vessel.coiMaxPax}
            required
            defaultValue={draft?.get("guests") ?? ""}
            className={input}
          />
        </label>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-xs font-medium text-ink">Crew tip</legend>
          <div className="flex gap-2">
            {tiers.map((bps) => (
              <label
                key={bps}
                className="flex flex-1 basis-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-ink has-[:checked]:border-accent has-[:checked]:font-medium"
              >
                <input type="radio" name="gratuityBps" value={bps} defaultChecked={String(bps) === tipDefault} />
                {bps / 100}%
              </label>
            ))}
          </div>
        </fieldset>

        <p className="text-xs text-muted">
          This holds the boat until the customer pays or you cancel it — it never expires on its
          own. They agree to the waiver when they pay.
        </p>

        <SubmitButton className="w-full rounded-card bg-accent px-4 py-2.5 text-sm font-semibold text-white">
          Book it
        </SubmitButton>
      </form>

      <VersionTag />
    </Shell>
  );
}
