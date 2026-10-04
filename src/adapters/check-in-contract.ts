/**
 * Check-in & waivers — the Repository contract for Phase 18.1 (issue #1115).
 *
 * Its own file rather than a section of `repository-contract.ts` (3,000+ lines), registered by
 * both adapters' test files the same way. Passing it on both is what makes the in-memory double
 * trustworthy for the check-in domain tests that follow in 18.3–18.8.
 *
 * Not a test file itself (no `.test`): it exports a function that registers the describe/it blocks.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { Admin, CrewMember, Event, Reservation, Vessel } from "../domain/entities.js";
import type { Guest, TripLink, WaiverReminder, WaiverTemplate } from "../checkin/entities.js";
import { CHECK_IN_CONFIG_DEFAULTS } from "../checkin/entities.js";
import type { Repository } from "../ports/repository.js";

const VESSEL = asId<"VesselId">("vessel-ci");
const CREW = asId<"CrewMemberId">("crew-ci");
const EVENT = asId<"EventId">("evt-ci");
const EVENT_2 = asId<"EventId">("evt-ci-2");
const RESV = asId<"ReservationId">("resv-ci");

const vessel = (): Vessel => ({ id: VESSEL, name: "Hops", coiMaxPax: 16, manning: [] });
const crew = (): CrewMember => ({
  id: CREW,
  name: "Mike R.",
  phone: "+15555550100",
  ratings: [],
  status: "active",
  reliabilityScore: null,
});
const admin = (): Admin => ({
  id: CREW,
  handle: "mike",
  name: "Mike R.",
  active: true,
  createdAt: "2026-09-01T12:00:00.000Z",
  deactivatedAt: null,
});
// Two departures need two slots: Postgres allows one Muster departure per boat, day and time
// (`events_muster_slot_identity`).
const event = (id = EVENT): Event => ({
  id,
  vesselId: VESSEL,
  date: "2026-10-10",
  time: id === EVENT ? "15:00" : "17:00",
  capacity: 16,
  status: "scheduled",
  source: "muster",
});
const reservation = (): Reservation => ({
  id: RESV,
  eventId: EVENT,
  customerName: "Carol",
  partySize: 12,
  status: "booked",
  source: "muster",
});

const template = (over: Partial<WaiverTemplate> = {}): WaiverTemplate => ({
  id: asId<"WaiverTemplateId">("wt-1"),
  version: "brewboat-2026-v1",
  body: "# Voyage Agreement\n\nI accept the risks.",
  effectiveFrom: "2026-09-01T00:00:00.000Z",
  postedAt: "2026-09-01T00:00:00.000Z",
  postedBy: String(CREW),
  ...over,
});

const adult = (over: Partial<Guest> = {}): Guest => ({
  id: asId<"GuestId">("guest-robert"),
  eventId: EVENT,
  reservationId: RESV,
  name: "Robert Smith",
  email: "robert@example.com",
  phone: "+15555550111",
  dob: "1980-04-02",
  isMinor: false,
  signedAt: "2026-10-01T18:00:00.000Z",
  waiverTemplateId: asId<"WaiverTemplateId">("wt-1"),
  signatureName: "Robert Smith",
  signedIp: "203.0.113.7",
  signedUserAgent: "Mozilla/5.0 (iPhone)",
  source: "self",
  createdAt: "2026-10-01T18:00:00.000Z",
  ...over,
});

const minor = (over: Partial<Guest> = {}): Guest => ({
  id: asId<"GuestId">("guest-kyle"),
  eventId: EVENT,
  reservationId: RESV,
  name: "Kyle Smith",
  dob: "2014-06-20",
  isMinor: true,
  guardianGuestId: asId<"GuestId">("guest-robert"),
  guardianRelation: "parent",
  source: "self",
  createdAt: "2026-10-01T18:00:00.000Z",
  ...over,
});

const byId = (a: Guest, b: Guest) => String(a.id).localeCompare(String(b.id));

export function runCheckInContract(
  label: string,
  makeFreshRepo: () => Promise<Repository>,
): void {
  describe(`Check-in & waivers contract — ${label}`, () => {
    let repo: Repository;
    beforeEach(async () => {
      repo = await makeFreshRepo();
      // The rows every reference below points at. Postgres enforces them (foreign keys);
      // in-memory does not, and saving them anyway keeps the two suites identical.
      await repo.saveVessel(vessel());
      await repo.saveCrewMember(crew());
      await repo.saveAdmin(admin());
      await repo.saveEvent(event());
      await repo.saveEvent(event(EVENT_2));
      await repo.saveReservation(reservation());
      await repo.postWaiverTemplate(template());
    });

    describe("waiver templates", () => {
      it("round-trips a posted version, markdown and all", async () => {
        expect(await repo.getWaiverTemplate(asId<"WaiverTemplateId">("wt-1"))).toEqual(template());
      });

      it("is insert-only: posting the same id again changes nothing", async () => {
        await repo.postWaiverTemplate(template({ body: "rewritten", version: "tampered" }));
        expect(await repo.getWaiverTemplate(asId<"WaiverTemplateId">("wt-1"))).toEqual(template());
      });

      it("the current version is the latest one that has taken effect, never a future one", async () => {
        const v2 = template({
          id: asId<"WaiverTemplateId">("wt-2"),
          version: "brewboat-2026-v2",
          effectiveFrom: "2026-10-01T00:00:00.000Z",
          postedAt: "2026-09-20T00:00:00.000Z",
        });
        const v3 = template({
          id: asId<"WaiverTemplateId">("wt-3"),
          version: "brewboat-2027-v1",
          effectiveFrom: "2027-01-01T00:00:00.000Z",
          postedAt: "2026-09-25T00:00:00.000Z",
        });
        await repo.postWaiverTemplate(v2);
        await repo.postWaiverTemplate(v3);

        expect((await repo.getCurrentWaiverTemplate("2026-09-15T00:00:00.000Z"))?.id).toBe("wt-1");
        expect((await repo.getCurrentWaiverTemplate("2026-10-01T00:00:00.000Z"))?.id).toBe("wt-2");
        expect((await repo.getCurrentWaiverTemplate("2026-12-31T23:59:59.000Z"))?.id).toBe("wt-2");
        expect((await repo.getCurrentWaiverTemplate("2027-01-02T00:00:00.000Z"))?.id).toBe("wt-3");
      });

      it("has no current version before the first takes effect", async () => {
        expect(await repo.getCurrentWaiverTemplate("2026-08-31T23:59:59.000Z")).toBeNull();
      });

      it("lists every version, newest effective first", async () => {
        await repo.postWaiverTemplate(
          template({ id: asId<"WaiverTemplateId">("wt-2"), effectiveFrom: "2026-10-01T00:00:00.000Z" }),
        );
        expect((await repo.listWaiverTemplates()).map((t) => t.id)).toEqual(["wt-2", "wt-1"]);
      });

      it("updates a version that has not taken effect yet — every field but the id", async () => {
        const scheduled = template({
          id: asId<"WaiverTemplateId">("wt-2"),
          effectiveFrom: "2026-10-05T04:00:00.000Z",
          postedAt: "2026-09-20T00:00:00.000Z",
        });
        await repo.postWaiverTemplate(scheduled);
        const edited = {
          ...scheduled,
          version: "brewboat-2026-v2",
          body: "Fixed words.",
          effectiveFrom: "2026-10-07T04:00:00.000Z",
          postedAt: "2026-09-29T18:14:00.000Z",
        };
        expect(await repo.updateWaiverTemplate(edited, "2026-09-29T18:14:00.000Z")).toBe(true);
        expect(await repo.getWaiverTemplate(asId<"WaiverTemplateId">("wt-2"))).toEqual(edited);
      });

      it("refuses to update a version that has taken effect, from its first moment on", async () => {
        // wt-1 took effect 2026-09-01T00:00Z; an update stamped that exact instant is already late.
        const attempt = template({ body: "rewritten", effectiveFrom: "2026-12-01T00:00:00.000Z" });
        expect(await repo.updateWaiverTemplate(attempt, "2026-09-01T00:00:00.000Z")).toBe(false);
        expect(await repo.getWaiverTemplate(asId<"WaiverTemplateId">("wt-1"))).toEqual(template());
      });

      it("reports an unknown version as not updated", async () => {
        const ghost = template({ id: asId<"WaiverTemplateId">("wt-ghost") });
        expect(await repo.updateWaiverTemplate(ghost, "2026-08-01T00:00:00.000Z")).toBe(false);
        expect(await repo.getWaiverTemplate(asId<"WaiverTemplateId">("wt-ghost"))).toBeNull();
      });
    });

    describe("trip links (18.3b)", () => {
      const link = (over: Partial<TripLink> = {}): TripLink => ({
        code: "K3F9QZ2M",
        eventId: EVENT,
        createdAt: "2026-09-30T12:00:00.000Z",
        ...over,
      });

      it("finds a trip link by its code and by its departure", async () => {
        await repo.insertTripLink(link());
        expect(await repo.getTripLinkByCode("K3F9QZ2M")).toEqual(link());
        expect(await repo.getTripLinkForEvent(EVENT)).toEqual(link());
        expect(await repo.getTripLinkByCode("ZZZZZZZZ")).toBeNull();
        expect(await repo.getTripLinkForEvent(EVENT_2)).toBeNull();
      });

      it("refuses a code already in use, rather than handing one trip's link to another", async () => {
        await repo.insertTripLink(link());
        await expect(repo.insertTripLink(link({ eventId: EVENT_2 }))).rejects.toThrow(/duplicate key/);
        expect(await repo.getTripLinkForEvent(EVENT_2)).toBeNull();
      });

      it("refuses a second code for the same departure — one link per trip", async () => {
        await repo.insertTripLink(link());
        await expect(repo.insertTripLink(link({ code: "BBBBBBBB" }))).rejects.toThrow(/duplicate key/);
        expect(await repo.getTripLinkByCode("BBBBBBBB")).toBeNull();
      });
    });

    describe("guests", () => {
      it("saves one signing's rows together and round-trips every field", async () => {
        await repo.saveGuests([adult(), minor()]);
        expect((await repo.listGuestsForEvent(EVENT)).sort(byId)).toEqual([minor(), adult()].sort(byId));
      });

      it("keeps a walk-up with no booking, and optional fields stay absent", async () => {
        const walkUp: Guest = {
          id: asId<"GuestId">("guest-walkup"),
          eventId: EVENT,
          name: "Big Mike",
          email: "mike@example.com",
          isMinor: false,
          signedAt: "2026-10-10T18:55:00.000Z",
          waiverTemplateId: asId<"WaiverTemplateId">("wt-1"),
          signatureName: "Mike",
          source: "self",
          createdAt: "2026-10-10T18:55:00.000Z",
        };
        await repo.saveGuests([walkUp]);
        expect(await repo.listGuestsForEvent(EVENT)).toEqual([walkUp]);
        expect(await repo.listGuestsForReservation(RESV)).toEqual([]);
      });

      it("never merges: two signings sharing a phone and an email are two rows", async () => {
        const dana = adult({ id: asId<"GuestId">("guest-dana"), name: "Dana Smith", dob: "1982-01-09" });
        await repo.saveGuests([adult()]);
        await repo.saveGuests([dana]);
        expect((await repo.listGuestsForEvent(EVENT)).map((g) => g.id).sort()).toEqual([
          "guest-dana",
          "guest-robert",
        ]);
      });

      it("is insert-only: saving an existing id does not rewrite the signature", async () => {
        await repo.saveGuests([adult()]);
        await repo.saveGuests([adult({ signatureName: "Someone Else", name: "Someone Else" })]);
        expect(await repo.listGuestsForEvent(EVENT)).toEqual([adult()]);
      });

      it("lists by departure and by booking, and nothing from another departure leaks in", async () => {
        const { reservationId: _drop, ...noBooking } = adult();
        const elsewhere: Guest = { ...noBooking, id: asId<"GuestId">("guest-other"), eventId: EVENT_2 };
        await repo.saveGuests([adult(), minor()]);
        await repo.saveGuests([elsewhere]);
        expect((await repo.listGuestsForEvent(EVENT)).map((g) => g.id).sort()).toEqual(["guest-kyle", "guest-robert"]);
        expect((await repo.listGuestsForEvent(EVENT_2)).map((g) => g.id)).toEqual(["guest-other"]);
        expect((await repo.listGuestsForReservation(RESV)).map((g) => g.id).sort()).toEqual([
          "guest-kyle",
          "guest-robert",
        ]);
      });

      it("checks a guest in, out, and in again — each call states the outcome, so repeats are harmless", async () => {
        await repo.saveGuests([adult()]);
        const tick = { at: "2026-10-10T18:58:00.000Z", by: CREW };

        await repo.setGuestCheckIn(asId<"GuestId">("guest-robert"), tick);
        await repo.setGuestCheckIn(asId<"GuestId">("guest-robert"), tick);
        expect((await repo.listGuestsForEvent(EVENT))[0]?.checkedIn).toEqual(tick);

        await repo.setGuestCheckIn(asId<"GuestId">("guest-robert"), null);
        expect((await repo.listGuestsForEvent(EVENT))[0]?.checkedIn).toBeUndefined();

        // Everything but the tick is untouched by it.
        expect((await repo.listGuestsForEvent(EVENT))[0]).toEqual(adult());
      });
    });

    describe("a tick that keeps to the boat's limit (18.5a)", () => {
      // The COI rule (spec §4a): ticks never record more people aboard than the boat may carry,
      // however many phones tick at once. `limit` is the boat's COI max, passed by the caller.
      const tick = { at: "2026-10-10T18:58:00.000Z", by: CREW };
      const guest = (n: number) => adult({ id: asId<"GuestId">(`guest-${n}`), name: `Guest ${n}` });
      const id = (n: number) => asId<"GuestId">(`guest-${n}`);
      const aboard = async (eventId = EVENT) =>
        (await repo.listGuestsForEvent(eventId)).filter((g) => g.checkedIn).map((g) => g.id).sort();

      it("ticks a guest aboard while there is room", async () => {
        await repo.saveGuests([guest(1)]);
        expect(await repo.checkInGuestIfRoom(EVENT, id(1), tick, 16)).toBe("ok");
        expect((await repo.listGuestsForEvent(EVENT))[0]?.checkedIn).toEqual(tick);
      });

      it("refuses at the limit and leaves the guest unticked; an untick frees the spot", async () => {
        await repo.saveGuests([guest(1), guest(2)]);
        expect(await repo.checkInGuestIfRoom(EVENT, id(1), tick, 1)).toBe("ok");
        expect(await repo.checkInGuestIfRoom(EVENT, id(2), tick, 1)).toBe("full");
        expect(await aboard()).toEqual(["guest-1"]);

        await repo.setGuestCheckIn(id(1), null);
        expect(await repo.checkInGuestIfRoom(EVENT, id(2), tick, 1)).toBe("ok");
        expect(await aboard()).toEqual(["guest-2"]);
      });

      it("a second tick of a guest already aboard is ok, keeps the first tick, and counts once", async () => {
        await repo.saveGuests([guest(1)]);
        await repo.checkInGuestIfRoom(EVENT, id(1), tick, 1);
        // At the limit, and still ok: a retry after a tick that did land is not a new person.
        expect(await repo.checkInGuestIfRoom(EVENT, id(1), { at: "2026-10-10T19:05:00.000Z", by: CREW }, 1)).toBe("ok");
        expect((await repo.listGuestsForEvent(EVENT))[0]?.checkedIn).toEqual(tick);
      });

      it("counts only this departure's guests against the limit", async () => {
        const { reservationId: _drop, ...noBooking } = guest(9);
        await repo.saveGuests([guest(1), { ...noBooking, eventId: EVENT_2 }]);
        expect(await repo.checkInGuestIfRoom(EVENT_2, id(9), tick, 1)).toBe("ok");
        expect(await repo.checkInGuestIfRoom(EVENT, id(1), tick, 1)).toBe("ok");
      });

      it("does not find a guest who is not on that departure", async () => {
        const { reservationId: _drop, ...noBooking } = guest(9);
        await repo.saveGuests([{ ...noBooking, eventId: EVENT_2 }]);
        expect(await repo.checkInGuestIfRoom(EVENT, id(9), tick, 16)).toBe("not_found");
        expect(await repo.checkInGuestIfRoom(EVENT, asId<"GuestId">("guest-ghost"), tick, 16)).toBe("not_found");
        expect(await aboard(EVENT_2)).toEqual([]);
      });
      // Two phones at once is pinned in `postgres-repository.test.ts`: a parallel burst here
      // passed with the row lock removed, because the first tick finished before the others
      // connected, so it proved nothing. The in-memory double is serial by construction.
    });

    describe("the departure count", () => {
      it("has none until the mate sets one", async () => {
        expect(await repo.getDepartureCount(EVENT)).toBeNull();
      });

      it("keeps only the current value — a new set replaces the old one", async () => {
        await repo.setDepartureCount(EVENT, { pax: 15, countedAt: "2026-10-10T18:58:00.000Z", countedBy: CREW });
        await repo.setDepartureCount(EVENT, { pax: 14, countedAt: "2026-10-10T19:01:00.000Z", countedBy: CREW });
        expect(await repo.getDepartureCount(EVENT)).toEqual({
          pax: 14,
          countedAt: "2026-10-10T19:01:00.000Z",
          countedBy: CREW,
        });
        expect(await repo.getDepartureCount(EVENT_2)).toBeNull();
      });

      it("survives a later write of the departure itself (the Xola pull, a reprice)", async () => {
        await repo.setDepartureCount(EVENT, { pax: 15, countedAt: "2026-10-10T18:58:00.000Z", countedBy: CREW });
        await repo.saveEvent({ ...event(), price: 50000 });
        expect((await repo.getDepartureCount(EVENT))?.pax).toBe(15);
      });

      it("is not part of the departure a normal read returns", async () => {
        await repo.setDepartureCount(EVENT, { pax: 15, countedAt: "2026-10-10T18:58:00.000Z", countedBy: CREW });
        expect(await repo.getEvent(EVENT)).toEqual(event());
      });
    });

    describe("reminder send records (18.7)", () => {
      const reminder = (over: Partial<WaiverReminder> = {}): WaiverReminder => ({
        reservationId: RESV,
        tripDate: "2026-10-10",
        daysBefore: 7,
        sentAt: "2026-10-03T12:00:00.000Z",
        ...over,
      });

      it("the first claim of a window wins; a second claim of the same window does not", async () => {
        expect(await repo.claimWaiverReminder(reminder())).toBe(true);
        expect(await repo.claimWaiverReminder(reminder({ sentAt: "2026-10-03T12:15:00.000Z" }))).toBe(false);
        expect(await repo.listWaiverRemindersForReservation(RESV)).toEqual([reminder()]);
      });

      it("another reminder day, or the same day before a different trip date, is its own window", async () => {
        expect(await repo.claimWaiverReminder(reminder())).toBe(true);
        expect(await repo.claimWaiverReminder(reminder({ daysBefore: 3, sentAt: "2026-10-07T12:00:00.000Z" }))).toBe(true);
        // The booking moved a week: its 7-day window for the new date has not been used.
        expect(
          await repo.claimWaiverReminder(reminder({ tripDate: "2026-10-17", sentAt: "2026-10-10T12:00:00.000Z" })),
        ).toBe(true);
        expect(
          (await repo.listWaiverRemindersForReservation(RESV))
            .map((r) => `${r.tripDate}/${r.daysBefore}`)
            .sort(),
        ).toEqual(["2026-10-10/3", "2026-10-10/7", "2026-10-17/7"]);
      });

      it("a released claim can be claimed again — a send that never happened is not recorded", async () => {
        await repo.claimWaiverReminder(reminder());
        await repo.releaseWaiverReminder(RESV, "2026-10-10", 7);
        expect(await repo.listWaiverRemindersForReservation(RESV)).toEqual([]);
        expect(await repo.claimWaiverReminder(reminder({ sentAt: "2026-10-03T12:15:00.000Z" }))).toBe(true);
      });

      it("releasing one window leaves the others alone", async () => {
        await repo.claimWaiverReminder(reminder());
        await repo.claimWaiverReminder(reminder({ daysBefore: 3, sentAt: "2026-10-07T12:00:00.000Z" }));
        await repo.releaseWaiverReminder(RESV, "2026-10-10", 3);
        expect(await repo.listWaiverRemindersForReservation(RESV)).toEqual([reminder()]);
      });
    });

    describe("settings", () => {
      it("fall back to the defaults when nothing is stored: 18, and 7 / 3 / 1 days", async () => {
        expect(await repo.getCheckInConfig()).toEqual(CHECK_IN_CONFIG_DEFAULTS);
        expect(CHECK_IN_CONFIG_DEFAULTS).toEqual({ ageOfMajority: 18, reminderDaysBefore: [7, 3, 1] });
      });

      it("store a partial change and keep the rest at their defaults", async () => {
        await repo.setCheckInConfig({ reminderDaysBefore: [5, 2] }, "2026-09-29T12:00:00.000Z");
        expect(await repo.getCheckInConfig()).toEqual({ ...CHECK_IN_CONFIG_DEFAULTS, reminderDaysBefore: [5, 2] });

        await repo.setCheckInConfig({ ageOfMajority: 21 }, "2026-09-29T12:05:00.000Z");
        expect(await repo.getCheckInConfig()).toEqual({ ageOfMajority: 21, reminderDaysBefore: [5, 2] });
      });

      it("read an invalid stored value back as the default, the same on both adapters", async () => {
        // `@code-review`, this branch: Postgres coerced a bad value on read and in-memory did not,
        // so a domain test run against the double would have passed on an answer production
        // never gives. One normalizer in core now serves both.
        await repo.setCheckInConfig(
          { ageOfMajority: 0, reminderDaysBefore: [3, -1] },
          "2026-09-29T12:10:00.000Z",
        );
        expect(await repo.getCheckInConfig()).toEqual(CHECK_IN_CONFIG_DEFAULTS);
      });

      it("store an empty reminder list as no reminders, not as the default", async () => {
        await repo.setCheckInConfig({ reminderDaysBefore: [] }, "2026-09-29T12:15:00.000Z");
        expect((await repo.getCheckInConfig()).reminderDaysBefore).toEqual([]);
      });
    });
  });
}
