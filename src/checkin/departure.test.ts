/**
 * The departure page (Phase 18.8, issue #1122) — who signed which waiver and when, who was checked
 * in, and the count, for one departure; the Waivers card on the calendar's booking pane; and the
 * integrity page's list of departures counted above their checked-in guests.
 *
 * Clock: the trip is Saturday 2026-10-10 at 3:00 PM on Hops, boat time America/New_York (EDT, so
 * 18:58Z reads 2:58 PM). Hops carries 16.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { CrewMember, Event, Reservation, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { DepartureCount, Guest, WaiverTemplate } from "./entities.js";
import {
  aboveCheckedInWarning,
  buildDepartureView,
  countedAboveHeadline,
  departureHref,
  loadCountedAboveCheckedIn,
  loadDepartureView,
  loadWaiverCard,
  waiverCardLines,
  type DepartureInput,
} from "./departure.js";

const EVENT = asId<"EventId">("slot_hops|2026-10-10|15:00");
const VESSEL = asId<"VesselId">("vessel-hops");
const MIKE = asId<"CrewMemberId">("crew-mike");
const RESV = asId<"ReservationId">("resv-amy");
const WT1 = asId<"WaiverTemplateId">("wt-1");
const WT2 = asId<"WaiverTemplateId">("wt-2");

const event: Event = {
  id: EVENT,
  vesselId: VESSEL,
  date: "2026-10-10",
  time: "15:00",
  capacity: 16,
  status: "scheduled",
  source: "muster",
};
const vessel: Vessel = { id: VESSEL, name: "Hops", coiMaxPax: 16, manning: [] };
const mike: CrewMember = {
  id: MIKE,
  name: "Mike Rossi",
  phone: "+15555550100",
  ratings: [],
  status: "active",
  reliabilityScore: null,
};
const amy: Reservation = {
  id: RESV,
  eventId: EVENT,
  customerName: "Amy Nowak",
  partySize: 12,
  status: "booked",
  source: "muster",
};
const template = (id: typeof WT1, effectiveFrom: string, version: string): WaiverTemplate => ({
  id,
  version,
  body: `# ${version}\n\nI accept the risks.`,
  effectiveFrom,
  postedAt: effectiveFrom,
  postedBy: "admin-eric",
});
// Effective at midnight boat time: 04:00Z in EDT.
const v1 = template(WT1, "2026-09-01T04:00:00.000Z", "brewboat-2026-v1");
const v2 = template(WT2, "2026-10-05T04:00:00.000Z", "brewboat-2026-v2");

function adult(id: string, name: string, over: Partial<Guest> = {}): Guest {
  return {
    id: asId<"GuestId">(id),
    eventId: EVENT,
    reservationId: RESV,
    name,
    email: `${id}@example.com`,
    phone: "+15555550111",
    dob: "1980-04-02",
    isMinor: false,
    signedAt: "2026-10-02T23:14:00.000Z", // Oct 2, 7:14 PM
    waiverTemplateId: WT1,
    signatureName: name,
    signedIp: "203.0.113.7",
    signedUserAgent: "Mozilla/5.0 (iPhone)",
    source: "self",
    createdAt: "2026-10-02T23:14:00.000Z",
    ...over,
  };
}
const tickedBy = (at: string) => ({ checkedIn: { at, by: MIKE } });

const robert = adult("g-robert", "Robert Smith", tickedBy("2026-10-10T18:51:00.000Z"));
const kyle: Guest = {
  id: asId<"GuestId">("g-kyle"),
  eventId: EVENT,
  reservationId: RESV,
  name: "Kyle Smith",
  dob: "2014-06-20",
  isMinor: true,
  guardianGuestId: robert.id,
  guardianRelation: "parent",
  source: "self",
  createdAt: "2026-10-02T23:14:00.000Z",
};
const carla = adult("g-carla", "Carla Vance");
const count = (pax: number, countedAt = "2026-10-10T18:58:00.000Z"): DepartureCount => ({ pax, countedAt, countedBy: MIKE });

function input(over: Partial<DepartureInput> = {}): DepartureInput {
  return {
    event,
    vessel,
    reservations: [amy],
    guests: [robert, kyle, carla],
    count: null,
    crewNames: new Map([[String(MIKE), "Mike Rossi"]]),
    templates: [v1, v2],
    ...over,
  };
}

describe("the departure page", () => {
  it("names the trip: boat · day · time", () => {
    expect(buildDepartureView(input()).heading).toBe("Hops · Sat, Oct 10 · 3:00 PM");
  });

  it("names the cruise when a booking says which it is", () => {
    expect(buildDepartureView(input({ cruise: "Sunset Sip" })).cruise).toBe("Sunset Sip");
    expect(buildDepartureView(input()).cruise).toBeUndefined();
  });

  it("links each booking to its calendar pane, and says when one was cancelled", () => {
    const gone: Reservation = { ...amy, id: asId<"ReservationId">("resv-old"), customerName: "Old Booker", status: "cancelled" };
    expect(buildDepartureView(input({ reservations: [amy, gone] })).bookings).toEqual([
      { name: "Amy Nowak", href: "/admin/calendar/resv-amy?date=2026-10-10", cancelled: false },
      { name: "Old Booker", href: "/admin/calendar/resv-old?date=2026-10-10", cancelled: true },
    ]);
  });

  describe("the count", () => {
    it("says who counted and when, on the boat's clock", () => {
      expect(buildDepartureView(input({ count: count(3) })).countLine).toBe("3 aboard · counted 2:58 PM by Mike Rossi");
    });

    it("adds the date when the count was set on another day", () => {
      // Oct 11, 9:10 AM EDT.
      expect(buildDepartureView(input({ count: count(3, "2026-10-11T13:10:00.000Z") })).countLine).toBe(
        "3 aboard · counted Oct 11, 9:10 AM by Mike Rossi",
      );
    });

    it("says so when nobody has counted", () => {
      expect(buildDepartureView(input()).countLine).toBe("Not counted yet.");
    });
  });

  describe("signed and checked in", () => {
    it("counts people signed (a guarded minor included) and signings ticked", () => {
      expect(buildDepartureView(input()).numbersLine).toBe("3 signed · 1 checked in");
    });

    it("never shows a number above the boat's limit", () => {
      const many = Array.from({ length: 5 }, (_, i) => adult(`g-${i}`, `Guest ${i}`, tickedBy("2026-10-10T18:50:00.000Z")));
      const view = buildDepartureView(input({ vessel: { ...vessel, coiMaxPax: 3 }, guests: many, count: count(3) }));
      expect(view.numbersLine).toBe("3 signed · 3 checked in");
      // Every name is still listed, as on the mate's screen.
      expect(view.people).toHaveLength(5);
    });
  });

  describe("the warning", () => {
    it("shows when the count is above the checked-in number", () => {
      expect(buildDepartureView(input({ count: count(5) })).warning).toBe(
        "4 more aboard than were checked in. They may be unsigned, or signed and not ticked.",
      );
    });

    it("is absent when the count equals or is below the checked-in number, or there is no count", () => {
      expect(buildDepartureView(input({ count: count(1) })).warning).toBeUndefined();
      expect(buildDepartureView(input({ count: count(0) })).warning).toBeUndefined();
      expect(buildDepartureView(input()).warning).toBeUndefined();
    });

    it("is one rule, shared with the integrity page", () => {
      expect(aboveCheckedInWarning(16, 12)).toBe(
        "4 more aboard than were checked in. They may be unsigned, or signed and not ticked.",
      );
      expect(aboveCheckedInWarning(12, 12)).toBeUndefined();
    });
  });

  describe("one row per person", () => {
    it("lists everyone alphabetically, with when they signed and whether they were checked in", () => {
      const people = buildDepartureView(input()).people;
      expect(people.map((p) => p.name)).toEqual(["Carla Vance", "Kyle Smith", "Robert Smith"]);
      const [c, , r] = people;
      expect(c).toMatchObject({ signedLine: "Signed Oct 2, 7:14 PM", checkedInLine: "Not checked in", checkedIn: false });
      expect(r).toMatchObject({ signedLine: "Signed Oct 2, 7:14 PM", checkedInLine: "✓ Checked in 2:51 PM by Mike", checkedIn: true });
    });

    it("shows a minor with their age and adult, signed for by that adult", () => {
      const k = buildDepartureView(input()).people.find((p) => p.name === "Kyle Smith");
      expect(k).toMatchObject({ detail: "(12) · w/ Robert", signedLine: "Signed for by Robert Smith" });
    });

    it("shows an obvious duplicate once, ×2, with each signing's time in its details", () => {
      const again = adult("g-carla-2", "carla  vance", { signedAt: "2026-10-09T14:00:00.000Z" }); // Oct 9, 10:00 AM
      const people = buildDepartureView(input({ guests: [robert, kyle, carla, again] })).people;
      const c = people.find((p) => p.name === "Carla Vance");
      expect(c?.times).toBe(2);
      expect(c?.signings.map((s) => s.heading)).toEqual(["Signed Oct 2, 7:14 PM", "Signed Oct 9, 10:00 AM"]);
      expect(buildDepartureView(input({ guests: [robert, kyle, carla, again] })).numbersLine).toBe("3 signed · 1 checked in");
    });

    it("gives each signing's details, a cleared field as a dash", () => {
      // Retention clears date of birth and the device evidence; this signer gave no phone.
      const { dob: _d, signedIp: _i, signedUserAgent: _u, phone: _p, ...cleared } = adult("g-dee", "Dee Park");
      const people = buildDepartureView(input({ guests: [robert, cleared] })).people;
      expect(people.find((p) => p.name === "Robert Smith")?.signings[0]?.rows).toEqual([
        { label: "Email", value: "g-robert@example.com" },
        { label: "Mobile", value: "+15555550111" },
        { label: "Date of birth", value: "Apr 2, 1980" },
        { label: "Waiver version", value: "Sep 1, 2026" },
        { label: "Device", value: "Mozilla/5.0 (iPhone)" },
        { label: "Network address", value: "203.0.113.7" },
      ]);
      expect(people.find((p) => p.name === "Dee Park")?.signings[0]?.rows).toEqual([
        { label: "Email", value: "g-dee@example.com" },
        { label: "Mobile", value: "—" },
        { label: "Date of birth", value: "—" },
        { label: "Waiver version", value: "Sep 1, 2026" },
        { label: "Device", value: "—" },
        { label: "Network address", value: "—" },
      ]);
    });

    it("gives a minor's waiver version as the adult's", () => {
      const k = buildDepartureView(input()).people.find((p) => p.name === "Kyle Smith");
      expect(k?.signings[0]?.rows).toContainEqual({ label: "Waiver version", value: "Sep 1, 2026" });
      expect(k?.signings[0]?.rows).toContainEqual({ label: "Date of birth", value: "Jun 20, 2014" });
    });

    it("is empty when nobody signed", () => {
      const view = buildDepartureView(input({ guests: [] }));
      expect(view.people).toEqual([]);
      expect(view.numbersLine).toBe("0 signed · 0 checked in");
    });
  });

  describe("the waiver text", () => {
    it("gives each version signed on this trip, with how many signed it, oldest first", () => {
      const late = adult("g-late", "Late Signer", { waiverTemplateId: WT2 });
      const versions = buildDepartureView(input({ guests: [robert, kyle, carla, late] })).versions;
      expect(versions.map((v) => ({ id: v.id, label: v.label, body: v.body }))).toEqual([
        { id: "wt-1", label: "Version of Sep 1, 2026 · 2 signed", body: v1.body },
        { id: "wt-2", label: "Version of Oct 5, 2026 · 1 signed", body: v2.body },
      ]);
    });

    it("leaves out a version nobody on this trip signed", () => {
      expect(buildDepartureView(input()).versions.map((v) => v.id)).toEqual(["wt-1"]);
    });
  });
});

describe("loading the departure page", () => {
  async function world(): Promise<InMemoryRepository> {
    const repo = new InMemoryRepository();
    await repo.saveVessel(vessel);
    await repo.saveCrewMember(mike);
    await repo.saveEvent(event);
    await repo.saveReservation(amy);
    await repo.postWaiverTemplate(v1);
    await repo.saveGuests([robert, kyle, carla]);
    await repo.setDepartureCount(EVENT, count(5));
    return repo;
  }

  it("reads the departure, its bookings, signings, count and the counter's name", async () => {
    const view = await loadDepartureView(await world(), EVENT);
    expect(view).toMatchObject({
      heading: "Hops · Sat, Oct 10 · 3:00 PM",
      countLine: "5 aboard · counted 2:58 PM by Mike Rossi",
      numbersLine: "3 signed · 1 checked in",
      warning: "4 more aboard than were checked in. They may be unsigned, or signed and not ticked.",
    });
    expect(view?.bookings.map((b) => b.name)).toEqual(["Amy Nowak"]);
    expect(view?.versions.map((v) => v.id)).toEqual(["wt-1"]);
  });

  it("is null for a departure that does not exist", async () => {
    expect(await loadDepartureView(await world(), asId<"EventId">("evt-ghost"))).toBeNull();
  });
});

describe("the Waivers card on the booking pane", () => {
  it("gives signed with checked in, and the count with who set it", () => {
    expect(
      waiverCardLines({ signed: 14, checkedIn: 12, count: count(16), counterName: "Mike Rossi", tripDate: "2026-10-10" }),
    ).toEqual({ signed: "14 · 12 checked in", counted: "16 aboard · 2:58 PM by Mike" });
  });

  it("adds the date when the count was set on another day", () => {
    expect(
      waiverCardLines({
        signed: 14,
        checkedIn: 12,
        count: count(16, "2026-10-11T13:10:00.000Z"),
        counterName: "Mike Rossi",
        tripDate: "2026-10-10",
      }).counted,
    ).toBe("16 aboard · Oct 11, 9:10 AM by Mike");
  });

  it("says so when nobody has signed or counted", () => {
    expect(waiverCardLines({ signed: 0, checkedIn: 0, count: null, counterName: undefined, tripDate: "2026-10-10" })).toEqual({
      signed: "Nobody has signed yet.",
      counted: "Not yet.",
    });
  });

  it("loads from the repository and links to the departure page", async () => {
    const repo = new InMemoryRepository();
    await repo.saveVessel(vessel);
    await repo.saveCrewMember(mike);
    await repo.saveEvent(event);
    await repo.saveGuests([robert, kyle, carla]);
    await repo.setDepartureCount(EVENT, count(3));
    expect(await loadWaiverCard(repo, event)).toEqual({
      signed: "3 · 1 checked in",
      counted: "3 aboard · 2:58 PM by Mike",
      href: "/admin/departure/slot_hops%7C2026-10-10%7C15%3A00",
    });
  });
});

describe("the integrity page's list", () => {
  it("names each departure counted above its checked-in guests, newest first, linked to its page", async () => {
    const repo = new InMemoryRepository();
    await repo.saveVessel(vessel);
    await repo.saveCrewMember(mike);
    const later: Event = { ...event, id: asId<"EventId">("evt-sun"), date: "2026-10-11", time: "13:00" };
    const fine: Event = { ...event, id: asId<"EventId">("evt-fine"), date: "2026-10-09" };
    for (const e of [event, later, fine]) await repo.saveEvent(e);
    await repo.saveGuests([robert, kyle, carla]);
    await repo.setDepartureCount(EVENT, count(16));
    await repo.setDepartureCount(later.id, count(2));
    await repo.setDepartureCount(fine.id, count(0));
    expect(await loadCountedAboveCheckedIn(repo)).toEqual([
      { label: "Hops · Sun, Oct 11 · 1:00 PM — counted 2, checked in 0", href: "/admin/departure/evt-sun" },
      {
        label: "Hops · Sat, Oct 10 · 3:00 PM — counted 16, checked in 1",
        href: "/admin/departure/slot_hops%7C2026-10-10%7C15%3A00",
      },
    ]);
  });

  it("heads the list with how many", () => {
    expect(countedAboveHeadline(1)).toBe("One departure counted more people than were checked in.");
    expect(countedAboveHeadline(3)).toBe("3 departures counted more people than were checked in.");
  });

  it("encodes the departure id into the page's path", () => {
    expect(departureHref(EVENT)).toBe("/admin/departure/slot_hops%7C2026-10-10%7C15%3A00");
  });
});
