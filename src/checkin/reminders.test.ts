/**
 * Waiver reminders (Phase 18.7, issue #1121) — the booker is texted, and emailed when there is an
 * address, on each reminder day until the party has signed. Spec: `docs/design/check-in-and-waivers.md`
 * §5 and `docs/design/check-in-surfaces.md` §B.
 *
 * Clock: Saturday 2026-10-03, 9:00 AM boat time (New York, EDT). The trip is the next Saturday,
 * 2026-10-10 at 3:00 PM, so today is its 7-days-before day. The send hours are pinned to 08:00–20:00
 * here rather than read from the suite's wide-open env, so the window is what is being tested.
 */
import { describe, expect, it } from "vitest";
import { FakeChannel } from "../adapters/fake-channel.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Event, Reservation, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { ChannelSendError, type ChannelPort } from "../ports/channel.js";
import { nonGsm7Chars } from "../reservations/sms-alphabet.js";
import type { Guest } from "./entities.js";
import { sendWaiverReminders, waiverReminderBody, type WaiverReminderDeps } from "./reminders.js";

const NOW = "2026-10-03T13:00:00.000Z"; // 9:00 AM EDT
const TRIP_DATE = "2026-10-10";
const VESSEL = asId<"VesselId">("vessel-hops");
const EVENT = asId<"EventId">("evt-sat");
const RESV = asId<"ReservationId">("resv-amy");
const HOURS = { start: "08:00", end: "20:00" };

const vessel = (coiMaxPax = 16): Vessel => ({ id: VESSEL, name: "Hops", coiMaxPax, manning: [] });
const event = (over: Partial<Event> = {}): Event => ({
  id: EVENT,
  vesselId: VESSEL,
  date: TRIP_DATE,
  time: "15:00",
  capacity: 16,
  status: "scheduled",
  source: "muster",
  ...over,
});
/** An override where `undefined` means "this field is absent" — a booking with no phone. */
type Over<T> = { [K in keyof T]?: T[K] | undefined };
function withOver<T extends object>(base: T, over: Over<T>): T {
  const out: Record<string, unknown> = { ...base, ...over };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as T;
}

const booking = (over: Over<Reservation> = {}): Reservation =>
  withOver<Reservation>(
    {
      id: RESV,
      eventId: EVENT,
      customerName: "Amy Nowak",
      partySize: 4,
      email: "amy@example.com",
      phone: "+12165550100",
      status: "booked",
      source: "muster",
    },
    over,
  );

function guest(id: string, name: string, over: Over<Guest> = {}): Guest {
  return withOver<Guest>(
    {
      id: asId<"GuestId">(id),
      eventId: EVENT,
      reservationId: RESV,
      name,
      email: `${id}@example.com`,
      dob: "1980-04-02",
      isMinor: false,
      signedAt: "2026-10-01T18:00:00.000Z",
      waiverTemplateId: asId<"WaiverTemplateId">("wt-1"),
      signatureName: name,
      source: "self",
      createdAt: "2026-10-01T18:00:00.000Z",
    },
    over,
  );
}
const robert = guest("g-robert", "Robert Smith");
/** A guarded minor: covered by Robert's signature, with none of their own. */
const kyle = guest("g-kyle", "Kyle Smith", {
  email: undefined,
  dob: "2014-06-20",
  isMinor: true,
  guardianGuestId: robert.id,
  signedAt: undefined,
  signatureName: undefined,
});
const grace = guest("g-grace", "Grace Kim", { dob: "1990-03-03" });
/** Grace again — an obvious duplicate, which counts once. */
const graceAgain = guest("g-grace-2", "grace  kim", { dob: "1990-03-03", createdAt: "2026-10-02T18:00:00.000Z" });

async function world(
  opts: { vessel?: Vessel; event?: Partial<Event>; booking?: Over<Reservation>; waiver?: boolean } = {},
): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveVessel(opts.vessel ?? vessel());
  await repo.saveEvent(event(opts.event));
  await repo.saveReservation(booking(opts.booking));
  if (opts.waiver !== false) {
    await repo.postWaiverTemplate({
      id: asId<"WaiverTemplateId">("wt-1"),
      version: "brewboat-2026-v1",
      body: "I accept the risks.",
      effectiveFrom: "2026-09-01T04:00:00.000Z",
      postedAt: "2026-09-01T04:00:00.000Z",
      postedBy: "crew-admin",
    });
  }
  return repo;
}

function deps(
  repo: InMemoryRepository,
  over: Partial<WaiverReminderDeps> = {},
): WaiverReminderDeps & { email: FakeChannel; sms: FakeChannel } {
  return {
    repo,
    email: new FakeChannel(() => new Date(NOW)),
    sms: new FakeChannel(() => new Date(NOW)),
    linkBase: "https://muster.test",
    now: () => NOW,
    civilWindow: HOURS,
    ...over,
  } as WaiverReminderDeps & { email: FakeChannel; sms: FakeChannel };
}

/** A channel that refuses every send, as Twilio does for a dead number. */
const refusing: ChannelPort = {
  send: async () => {
    throw new ChannelSendError("SMS", 400, "the number +12165550100 is not a mobile number");
  },
};
/** A channel that writes the message down and sends nothing — a deploy with no Twilio keys. */
const loggingOnly: ChannelPort = {
  send: async () => ({ deliveredAt: NOW, loggedOnly: true }),
};

const at = (iso: string) => () => iso;

describe("waiver reminders", () => {
  it("texts and emails the booker on the 7-days-before day, with the count and the party page", async () => {
    const repo = await world();
    await repo.saveGuests([robert, kyle]);
    const d = deps(repo);

    expect(await sendWaiverReminders(d)).toEqual({ sent: 1, failed: 0 });

    expect(d.sms.sent).toHaveLength(1);
    expect(d.sms.sent[0]?.to).toEqual({ phone: "+12165550100" });
    expect(d.email.sent).toHaveLength(1);
    expect(d.email.sent[0]?.to).toEqual({ email: "amy@example.com" });
    const body = d.sms.sent[0]!.body;
    expect(d.email.sent[0]?.body).toBe(body);
    // Robert and his son: two of four, the son covered by his father's signature.
    expect(body).toContain("2 of 4");
    expect(body).toContain("Sat, Oct 10 at 3:00 PM");
    expect(body).toMatch(/https:\/\/muster\.test\/b\/[^/\s]+\/party/);
    // The boat is never named to a customer.
    expect(body).not.toContain("Hops");
  });

  it("goes out only inside the send hours, boat time", async () => {
    const repo = await world();
    // 7:30 AM EDT: the right day, too early.
    const early = deps(repo, { now: at("2026-10-03T11:30:00.000Z") });
    expect(await sendWaiverReminders(early)).toEqual({ sent: 0, failed: 0 });
    expect(early.sms.sent).toHaveLength(0);

    // 8:00 AM EDT: the window opens.
    const opening = deps(repo, { now: at("2026-10-03T12:00:00.000Z") });
    expect(await sendWaiverReminders(opening)).toEqual({ sent: 1, failed: 0 });

    // 8:00 PM EDT is past the window (half-open), on a fresh booking's day.
    const late = await world();
    const evening = deps(late, { now: at("2026-10-04T00:00:00.000Z") });
    expect(await sendWaiverReminders(evening)).toEqual({ sent: 0, failed: 0 });
  });

  it("sends nothing on a day that is not a reminder day", async () => {
    const repo = await world();
    // Six days before: between the 7 and the 3.
    const d = deps(repo, { now: at("2026-10-04T13:00:00.000Z") });
    expect(await sendWaiverReminders(d)).toEqual({ sent: 0, failed: 0 });
    expect(d.sms.sent).toHaveLength(0);
    // A missed reminder day is not made up later: the 7 never went, and the 6th day still sends nothing.
    expect(await repo.listWaiverRemindersForReservation(RESV)).toEqual([]);
  });

  it("the day is the boat's: 1 AM UTC on the 4th is still the evening of the 3rd in New York", async () => {
    const repo = await world();
    // 2026-10-04T01:00Z is 9:00 PM EDT on the 3rd — the 7-days-before day, but after the window.
    expect((await sendWaiverReminders(deps(repo, { now: at("2026-10-04T01:00:00.000Z") }))).sent).toBe(0);
    // Widen the window to the whole evening and it is the 3rd's reminder that goes.
    const d = deps(repo, { now: at("2026-10-04T01:00:00.000Z"), civilWindow: { start: "08:00", end: "23:00" } });
    expect((await sendWaiverReminders(d)).sent).toBe(1);
    expect((await repo.listWaiverRemindersForReservation(RESV))[0]?.daysBefore).toBe(7);
  });

  it("never sends twice for one window", async () => {
    const repo = await world();
    const d = deps(repo);
    expect(await sendWaiverReminders(d)).toEqual({ sent: 1, failed: 0 });
    const later = deps(repo, { now: at("2026-10-03T13:15:00.000Z") });
    expect(await sendWaiverReminders(later)).toEqual({ sent: 0, failed: 0 });
    expect(later.sms.sent).toHaveLength(0);
  });

  it("each reminder day is its own window: 7, then 3, then 1", async () => {
    const repo = await world();
    expect((await sendWaiverReminders(deps(repo))).sent).toBe(1);
    expect((await sendWaiverReminders(deps(repo, { now: at("2026-10-07T13:00:00.000Z") }))).sent).toBe(1);
    expect((await sendWaiverReminders(deps(repo, { now: at("2026-10-09T13:00:00.000Z") }))).sent).toBe(1);
    expect((await repo.listWaiverRemindersForReservation(RESV)).map((r) => r.daysBefore).sort()).toEqual([1, 3, 7]);
  });

  it("follows the admin's reminder days, and an empty list sends nothing", async () => {
    const repo = await world();
    await repo.setCheckInConfig({ reminderDaysBefore: [5] }, NOW);
    expect((await sendWaiverReminders(deps(repo))).sent).toBe(0);
    expect((await sendWaiverReminders(deps(repo, { now: at("2026-10-05T13:00:00.000Z") }))).sent).toBe(1);

    const off = await world();
    await off.setCheckInConfig({ reminderDaysBefore: [] }, NOW);
    expect((await sendWaiverReminders(deps(off))).sent).toBe(0);
  });

  it("stops once the party has signed — a guarded minor counts, and someone who signed twice counts once", async () => {
    const repo = await world({ booking: { partySize: 3 } });
    // Robert, his son, and Grace twice: three people, which is the party.
    await repo.saveGuests([robert, kyle]);
    await repo.saveGuests([grace]);
    await repo.saveGuests([graceAgain]);
    const d = deps(repo);
    expect(await sendWaiverReminders(d)).toEqual({ sent: 0, failed: 0 });
    expect(d.sms.sent).toHaveLength(0);
  });

  it("counts a duplicate once when the party is not done", async () => {
    const repo = await world({ booking: { partySize: 5 } });
    await repo.saveGuests([robert, kyle]);
    await repo.saveGuests([grace]);
    await repo.saveGuests([graceAgain]);
    const d = deps(repo);
    await sendWaiverReminders(d);
    expect(d.sms.sent[0]?.body).toContain("3 of 5");
  });

  it("never shows a count above the boat's limit", async () => {
    const repo = await world({ vessel: vessel(16), booking: { partySize: 20 } });
    const d = deps(repo);
    await sendWaiverReminders(d);
    expect(d.sms.sent[0]?.body).toContain("0 of 16");
  });

  it("skips a cancelled booking, a cancelled departure and a checkout still in flight", async () => {
    // The same world, live, does send — so the skips below are the status, not the setup.
    expect((await sendWaiverReminders(deps(await world()))).sent).toBe(1);
    for (const opts of [
      { booking: { status: "cancelled" as const } },
      { event: { status: "cancelled" as const } },
      { booking: { status: "pending" as const } },
    ]) {
      const repo = await world(opts);
      const d = deps(repo);
      expect(await sendWaiverReminders(d)).toEqual({ sent: 0, failed: 0 });
      expect(d.sms.sent).toHaveLength(0);
    }
  });

  it("sends nothing while no waiver is in effect — nobody could sign", async () => {
    const repo = await world({ waiver: false });
    const d = deps(repo);
    expect(await sendWaiverReminders(d)).toEqual({ sent: 0, failed: 0 });
    expect(d.sms.sent).toHaveLength(0);
    // A version posted for next week is not in effect today either.
    await repo.postWaiverTemplate({
      id: asId<"WaiverTemplateId">("wt-later"),
      version: "brewboat-2026-v2",
      body: "Next week's words.",
      effectiveFrom: "2026-10-08T04:00:00.000Z",
      postedAt: NOW,
      postedBy: "crew-admin",
    });
    expect(await sendWaiverReminders(deps(repo))).toEqual({ sent: 0, failed: 0 });
  });

  it("a booking with no phone is emailed, and that counts as reminded", async () => {
    const repo = await world({ booking: { phone: undefined } });
    const d = deps(repo);
    expect(await sendWaiverReminders(d)).toEqual({ sent: 1, failed: 0 });
    expect(d.email.sent).toHaveLength(1);
    expect(d.sms.sent).toHaveLength(0);
    expect(await sendWaiverReminders(deps(repo, { now: at("2026-10-03T13:15:00.000Z") }))).toEqual({
      sent: 0,
      failed: 0,
    });
  });

  it("when nobody was told, the window is given back, the trail says so once, and a later tick tries again", async () => {
    const repo = await world({ booking: { email: undefined } });
    const first = deps(repo, { sms: refusing as FakeChannel });
    expect(await sendWaiverReminders(first)).toEqual({ sent: 0, failed: 1 });
    expect(await repo.listWaiverRemindersForReservation(RESV)).toEqual([]);

    // Still failing a tick later: one trail row for the window, not one per tick.
    await sendWaiverReminders(deps(repo, { sms: refusing as FakeChannel, now: at("2026-10-03T13:15:00.000Z") }));
    const failed = (await repo.listTrailEventsFor(RESV, [])).filter((e) => e.type === "waiver_reminder_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.actorKind).toBe("engine");
    expect(failed[0]?.metadata.reason).toBe("email=absent sms=failed");
    // Nothing the provider echoed — no phone number — reaches the durable row.
    expect(JSON.stringify(failed[0])).not.toContain("2165550100");

    // The carrier recovers: the next tick sends.
    const retry = deps(repo, { now: at("2026-10-03T13:30:00.000Z") });
    expect(await sendWaiverReminders(retry)).toEqual({ sent: 1, failed: 0 });
    expect(retry.sms.sent).toHaveLength(1);
  });

  it("a message only written to the log is not a reminder sent", async () => {
    const repo = await world({ booking: { email: undefined } });
    expect(await sendWaiverReminders(deps(repo, { sms: loggingOnly as FakeChannel }))).toEqual({ sent: 0, failed: 1 });
    expect(await repo.listWaiverRemindersForReservation(RESV)).toEqual([]);
  });

  it("an email that went with a text that failed is a reminder sent, and the trail names the failed text", async () => {
    const repo = await world();
    const d = deps(repo, { sms: refusing as FakeChannel });
    expect(await sendWaiverReminders(d)).toEqual({ sent: 1, failed: 0 });
    expect(await repo.listWaiverRemindersForReservation(RESV)).toEqual([
      { reservationId: RESV, tripDate: TRIP_DATE, daysBefore: 7, sentAt: NOW },
    ]);
    const failed = (await repo.listTrailEventsFor(RESV, [])).filter((e) => e.type === "waiver_reminder_failed");
    expect(failed.map((e) => e.metadata.reason)).toEqual(["email=sent sms=failed"]);
  });

  it("a booking with no phone and no email is not claimed, and the trail says why", async () => {
    const repo = await world({ booking: { phone: undefined, email: undefined } });
    expect(await sendWaiverReminders(deps(repo))).toEqual({ sent: 0, failed: 1 });
    expect(await repo.listWaiverRemindersForReservation(RESV)).toEqual([]);
    const failed = (await repo.listTrailEventsFor(RESV, [])).filter((e) => e.type === "waiver_reminder_failed");
    expect(failed.map((e) => e.metadata.reason)).toEqual(["email=absent sms=absent"]);
  });

  it("one booking that throws does not cost the others their reminder", async () => {
    const repo = await world();
    const other = asId<"ReservationId">("resv-bea");
    await repo.saveReservation(booking({ id: other, customerName: "Bea Ruiz", phone: "+12165550199", email: undefined }));
    const original = repo.listGuestsForReservation.bind(repo);
    repo.listGuestsForReservation = async (id) => {
      if (id === RESV) throw new Error("connection reset");
      return original(id);
    };
    const failures: string[] = [];
    const d = deps(repo, { onFailure: (s) => failures.push(s) });
    expect(await sendWaiverReminders(d)).toEqual({ sent: 1, failed: 1 });
    expect(d.sms.sent.map((m) => m.to)).toEqual([{ phone: "+12165550199" }]);
    expect(failures.join("\n")).toContain("resv-amy");
  });
});

describe("the reminder message", () => {
  const body = waiverReminderBody({
    customerName: "Amy Nowak",
    covered: 14,
    of: 16,
    date: TRIP_DATE,
    time: "15:00",
    partyUrl: "https://muster.test/b/K3F9QZ2M/party",
  });

  it("stays inside GSM-7, so a text is never re-encoded at twice the cost", () => {
    expect(body.length).toBeGreaterThan(0);
    expect(nonGsm7Chars(body, ["Amy"])).toEqual([]);
  });

  it("asks the booker to look, never to forward this link — it opens their booking", () => {
    expect(body).toContain("Hi Amy,");
    expect(body).toContain("14 of 16");
    expect(body).toContain("https://muster.test/b/K3F9QZ2M/party");
    expect(body).not.toMatch(/forward this|send this link|share this link/i);
  });
});
