/**
 * Crew check-in (Phase 18.5a, issue #1119) — what the mate's screen shows for one departure, who
 * may tick and count, and the boat's limit on both. The page is
 * `app/(crew)/crew/shift/[shiftId]/check-in/[eventId]`; the spec is
 * `docs/design/check-in-surfaces.md` §C and `docs/design/check-in-and-waivers.md` §3, §4a, §7.
 *
 * Clock: Saturday 2026-10-10. The boat carries 3 (a small COI max, so "full" is cheap to reach).
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { CrewMember, Event, Seat, Shift, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { DepartureCount, Guest } from "./entities.js";
import { buildCheckInScreen, checkInTrip, setGuestAboard, setPassengerCount } from "./check-in.js";

const TODAY = "2026-10-10";
const NOW = "2026-10-10T18:58:00.000Z";
const VESSEL = asId<"VesselId">("vessel-hops");
const SHIFT = asId<"ShiftId">("shift-sat");
const EVENT = asId<"EventId">("evt-3pm");
const OTHER_EVENT = asId<"EventId">("evt-5pm-elsewhere");
const QUINT = asId<"CrewMemberId">("crew-quint");
const HOOPER = asId<"CrewMemberId">("crew-hooper");
const STRANGER = asId<"CrewMemberId">("crew-stranger");

function guest(id: string, name: string, over: Partial<Guest> = {}): Guest {
  return {
    id: asId<"GuestId">(id),
    eventId: EVENT,
    name,
    email: `${id}@example.com`,
    dob: "1980-04-02",
    isMinor: false,
    signedAt: "2026-10-01T18:00:00.000Z",
    waiverTemplateId: asId<"WaiverTemplateId">("wt-1"),
    signatureName: name,
    source: "self",
    createdAt: "2026-10-01T18:00:00.000Z",
    ...over,
  };
}

const robert = guest("g-robert", "Robert Smith");
// A guarded minor: no signature and no email of their own.
const kyle: Guest = {
  id: asId<"GuestId">("g-kyle"),
  eventId: EVENT,
  name: "Kyle Smith",
  dob: "2014-06-20",
  isMinor: true,
  guardianGuestId: robert.id,
  source: "self",
  createdAt: "2026-10-01T18:00:00.000Z",
};
const tick = { at: "2026-10-10T18:50:00.000Z", by: QUINT };

async function world(coiMaxPax = 3): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  const vessel: Vessel = { id: VESSEL, name: "Hops", coiMaxPax, manning: [] };
  const crew = (id: typeof QUINT, name: string): CrewMember => ({
    id,
    name,
    phone: "555-0001",
    ratings: [],
    status: "active",
    reliabilityScore: null,
  });
  const event = (id: typeof EVENT, time: string): Event => ({
    id,
    vesselId: VESSEL,
    date: TODAY,
    time,
    capacity: 16,
    status: "scheduled",
    source: "muster",
  });
  const shift: Shift = { id: SHIFT, vesselId: VESSEL, date: TODAY, state: "Crewed", eventIds: [EVENT] };
  const seats: Seat[] = [
    { id: asId<"SeatId">("seat-1"), shiftId: SHIFT, role: asId<"RoleTypeId">("role-captain"), kind: "required", state: "Confirmed", assignedCrewMemberId: QUINT },
    { id: asId<"SeatId">("seat-2"), shiftId: SHIFT, role: asId<"RoleTypeId">("role-mate"), kind: "required", state: "Claimed", assignedCrewMemberId: HOOPER },
  ];
  await repo.saveVessel(vessel);
  for (const c of [crew(QUINT, "Quint"), crew(HOOPER, "Hooper"), crew(STRANGER, "Stranger")]) await repo.saveCrewMember(c);
  await repo.saveEvent(event(EVENT, "15:00"));
  await repo.saveEvent(event(OTHER_EVENT, "17:00"));
  await repo.saveShift(shift);
  for (const s of seats) await repo.saveSeat(s);
  return repo;
}

const aboard = async (repo: InMemoryRepository) =>
  (await repo.listGuestsForEvent(EVENT)).filter((g) => g.checkedIn).map((g) => g.name).sort();

describe("buildCheckInScreen — what the mate sees", () => {
  it("still to board and checked in, each alphabetical by the name as typed, ignoring case", () => {
    const s = buildCheckInScreen(
      [guest("g1", "carla Vance"), guest("g2", "Amy Nowak", { checkedIn: tick }), guest("g3", "Bob Dunn"), guest("g4", "Zed")],
      16,
      null,
      TODAY,
    );
    expect(s.rows.map((r) => r.name)).toEqual(["Amy Nowak", "Bob Dunn", "carla Vance", "Zed"]);
    expect(s.toBoard.map((r) => r.name)).toEqual(["Bob Dunn", "carla Vance", "Zed"]);
    expect(s.aboard.map((r) => r.name)).toEqual(["Amy Nowak"]);
    expect(s.aboard[0]).toMatchObject({ guestId: "g2", checkedIn: true });
  });

  it("a minor is their own row: their age today and who they came with", () => {
    const s = buildCheckInScreen([robert, kyle], 16, null, TODAY);
    expect(s.toBoard.find((r) => r.name === "Kyle Smith")?.detail).toBe("(12) · w/ Robert");
    expect(s.toBoard.find((r) => r.name === "Robert Smith")?.detail).toBeUndefined();
  });

  it("the age is on the boat's calendar — a birthday tomorrow is not had yet", () => {
    const s = buildCheckInScreen([robert, { ...kyle, dob: "2014-10-11" }], 16, null, TODAY);
    expect(s.toBoard.find((r) => r.name === "Kyle Smith")?.detail).toBe("(11) · w/ Robert");
  });

  it("a minor whose date of birth is gone (retention) still shows who they came with", () => {
    const { dob: _gone, ...noDob } = kyle;
    const s = buildCheckInScreen([robert, noDob], 16, null, TODAY);
    expect(s.toBoard.find((r) => r.name === "Kyle Smith")?.detail).toBe("w/ Robert");
  });

  it("counts checked in and signed — every row is a person on a signed waiver, minors included", () => {
    const s = buildCheckInScreen([robert, kyle, guest("g5", "Grace Kim", { checkedIn: tick })], 16, null, TODAY);
    expect([s.checkedIn, s.signed, s.limit, s.full]).toEqual([1, 3, 16, false]);
  });

  it("is full once the checked-in reach the boat's limit", () => {
    const s = buildCheckInScreen([guest("g1", "A", { checkedIn: tick }), guest("g2", "B", { checkedIn: tick }), guest("g3", "C")], 2, null, TODAY);
    expect(s.full).toBe(true);
  });

  it("no number shown passes the boat's limit (the COI rule) — every name is still listed", () => {
    const five = ["A", "B", "C", "D", "E"].map((n, i) => guest(`g${i}`, n, i < 4 ? { checkedIn: tick } : {}));
    const s = buildCheckInScreen(five, 3, null, TODAY);
    expect([s.checkedIn, s.signed]).toEqual([3, 3]);
    expect(s.toBoard.length + s.aboard.length).toBe(5);
  });

  it("the passenger count starts at the number signed, until the mate confirms one (operator, 2026-10-02)", () => {
    const rows = [robert, kyle, guest("g5", "Grace Kim")];
    expect(buildCheckInScreen(rows, 16, null, TODAY).startingCount).toBe(3);
    // Never above the limit, even with more signed than the boat may carry.
    expect(buildCheckInScreen(rows, 2, null, TODAY).startingCount).toBe(2);
    const counted: DepartureCount = { pax: 5, countedAt: NOW, countedBy: QUINT };
    expect(buildCheckInScreen(rows, 16, counted, TODAY).startingCount).toBe(5);
  });

  it("an empty departure is all zeros", () => {
    const s = buildCheckInScreen([], 16, null, TODAY);
    expect([s.toBoard, s.aboard, s.checkedIn, s.signed, s.startingCount, s.full]).toEqual([[], [], 0, 0, 0, false]);
  });
});

describe("checkInTrip — who may open a departure's check-in", () => {
  it("confirmed crew on the shift, for a departure on it — with the boat's limit and name", async () => {
    const repo = await world(12);
    expect(await checkInTrip(repo, SHIFT, EVENT, QUINT)).toEqual({
      eventId: EVENT,
      date: TODAY,
      time: "15:00",
      vesselName: "Hops",
      limit: 12,
    });
  });

  it.each([
    ["crew not on the shift", SHIFT, EVENT, STRANGER],
    ["crew whose seat is not confirmed", SHIFT, EVENT, HOOPER],
    ["a departure that is not on the shift", SHIFT, OTHER_EVENT, QUINT],
    ["a shift that does not exist", asId<"ShiftId">("shift-ghost"), EVENT, QUINT],
  ])("nobody else: %s", async (_label, shiftId, eventId, crewId) => {
    const repo = await world();
    expect(await checkInTrip(repo, shiftId, eventId, crewId)).toBeNull();
  });
});

describe("setGuestAboard — a tick, and its undo", () => {
  const args = (guestId: string, on: boolean, crewId = QUINT) => ({
    shiftId: SHIFT,
    eventId: EVENT,
    guestId: asId<"GuestId">(guestId),
    crewId,
    aboard: on,
    now: NOW,
  });

  it("ticks a guest aboard, stamped with when and by whom", async () => {
    const repo = await world();
    await repo.saveGuests([robert]);
    expect(await setGuestAboard(repo, args("g-robert", true))).toBe("ok");
    expect((await repo.listGuestsForEvent(EVENT))[0]?.checkedIn).toEqual({ at: NOW, by: QUINT });
  });

  it("untick takes the guest back off", async () => {
    const repo = await world();
    await repo.saveGuests([{ ...robert, checkedIn: tick }]);
    expect(await setGuestAboard(repo, args("g-robert", false))).toBe("ok");
    expect(await aboard(repo)).toEqual([]);
  });

  it("refuses a tick once the boat is at its limit, and writes nothing", async () => {
    const repo = await world(2);
    await repo.saveGuests([guest("g1", "A", { checkedIn: tick }), guest("g2", "B", { checkedIn: tick }), guest("g3", "C")]);
    expect(await setGuestAboard(repo, args("g3", true))).toBe("full");
    expect(await aboard(repo)).toEqual(["A", "B"]);
    // An untick is never refused, and frees the spot.
    expect(await setGuestAboard(repo, args("g1", false))).toBe("ok");
    expect(await setGuestAboard(repo, args("g3", true))).toBe("ok");
  });

  it("refuses crew who may not check this departure in, and writes nothing", async () => {
    const repo = await world();
    await repo.saveGuests([robert, { ...kyle, checkedIn: tick }]);
    expect(await setGuestAboard(repo, args("g-robert", true, STRANGER))).toBe("not_allowed");
    expect(await setGuestAboard(repo, args("g-kyle", false, HOOPER))).toBe("not_allowed");
    expect(await aboard(repo)).toEqual(["Kyle Smith"]);
  });

  it("does not reach a guest on another departure — neither a tick nor an untick", async () => {
    const repo = await world();
    await repo.saveGuests([guest("g-away", "Away Guest", { eventId: OTHER_EVENT, checkedIn: tick })]);
    expect(await setGuestAboard(repo, args("g-away", false))).toBe("not_found");
    expect(await setGuestAboard(repo, args("g-ghost", true))).toBe("not_found");
    expect((await repo.listGuestsForEvent(OTHER_EVENT))[0]?.checkedIn).toEqual(tick);
  });
});

describe("setPassengerCount — the mate's number", () => {
  const args = (pax: number, crewId = QUINT) => ({ shiftId: SHIFT, eventId: EVENT, crewId, pax, now: NOW });

  it("records the count with when and by whom, and a new one replaces it", async () => {
    const repo = await world(3);
    expect(await setPassengerCount(repo, args(2))).toBe("ok");
    expect(await repo.getDepartureCount(EVENT)).toEqual({ pax: 2, countedAt: NOW, countedBy: QUINT });
    expect(await setPassengerCount(repo, args(3))).toBe("ok");
    expect((await repo.getDepartureCount(EVENT))?.pax).toBe(3);
  });

  it("takes anything from 0 to the boat's limit", async () => {
    const repo = await world(3);
    expect(await setPassengerCount(repo, args(0))).toBe("ok");
    expect(await setPassengerCount(repo, args(3))).toBe("ok");
  });

  it.each([
    ["one over the boat's limit", 4],
    ["below zero", -1],
    ["a fraction", 2.5],
    ["not a number", Number.NaN],
  ])("refuses %s, and keeps the count it had", async (_label, pax) => {
    const repo = await world(3);
    await setPassengerCount(repo, args(2));
    expect(await setPassengerCount(repo, args(pax))).toBe("bad_count");
    expect((await repo.getDepartureCount(EVENT))?.pax).toBe(2);
  });

  it("refuses crew who may not count this departure, and writes nothing", async () => {
    const repo = await world(3);
    expect(await setPassengerCount(repo, args(2, STRANGER))).toBe("not_allowed");
    expect(await repo.getDepartureCount(EVENT)).toBeNull();
  });
});
