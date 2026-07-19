/**
 * Gratuity payroll (12.3b, DEC-124) — the pure even-split, the report wiring (window +
 * booked-only + seat denominator + Gusto join), and the Gusto CSV.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { CrewMember, Gratuity, Seat, Shift } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import {
  buildGratuityPayroll,
  gustoTipsCsv,
  splitGratuity,
  type GustoTipRow,
} from "./gratuity-payroll.js";

const evId = (s: string) => asId<"EventId">(s);
const grat = (id: string, eventId: string, amountCents: number, over: Partial<Gratuity> = {}): Gratuity => ({
  id: asId<"GratuityId">(id),
  eventId: evId(eventId),
  reservationId: asId<"ReservationId">("resv-1"),
  kind: "pre",
  amountCents,
  createdAt: "2026-07-04T12:00:00.000Z",
  ...over,
});

describe("splitGratuity — integer-cent even split (DEC-002/124)", () => {
  it("splits an event pool evenly among its crew", () => {
    const out = splitGratuity({
      gratuities: [grat("g1", "e1", 1000)],
      crewByEvent: new Map([["e1", ["c-a", "c-b"]]]),
    });
    expect(out.perCrew).toEqual([
      { crewMemberId: "c-a", cents: 500 },
      { crewMemberId: "c-b", cents: 500 },
    ]);
    expect(out.totalCents).toBe(1000);
    expect(out.warnings).toEqual([]);
  });

  it("distributes the remainder deterministically to the lexically-first crew", () => {
    const out = splitGratuity({
      gratuities: [grat("g1", "e1", 1001)],
      crewByEvent: new Map([["e1", ["c-c", "c-a", "c-b"]]]), // unsorted input
    });
    // 1001 / 3 = 333 r 2 → the two lexically-first (c-a, c-b) get +1
    expect(out.perCrew).toEqual([
      { crewMemberId: "c-a", cents: 334 },
      { crewMemberId: "c-b", cents: 334 },
      { crewMemberId: "c-c", cents: 333 },
    ]);
    expect(out.perCrew.reduce((s, p) => s + p.cents, 0)).toBe(1001); // every cent allocated
  });

  it("sums multiple gratuities (pre + post) per event before splitting", () => {
    const out = splitGratuity({
      gratuities: [grat("g1", "e1", 600), grat("g2", "e1", 400, { kind: "post" })],
      crewByEvent: new Map([["e1", ["c-a", "c-b"]]]),
    });
    expect(out.perCrew).toEqual([
      { crewMemberId: "c-a", cents: 500 },
      { crewMemberId: "c-b", cents: 500 },
    ]);
  });

  it("a pool with no crew is unsplit + warned (money surfaced, never dropped)", () => {
    const out = splitGratuity({
      gratuities: [grat("g1", "e1", 1000)],
      crewByEvent: new Map(),
    });
    expect(out.perCrew).toEqual([]);
    expect(out.totalCents).toBe(0);
    expect(out.warnings[0]).toContain("no confirmed crew");
  });

  it("crew across two events accumulate their shares", () => {
    const out = splitGratuity({
      gratuities: [grat("g1", "e1", 1000), grat("g2", "e2", 500)],
      crewByEvent: new Map([["e1", ["c-a", "c-b"]], ["e2", ["c-a"]]]),
    });
    // c-a: 500 (e1) + 500 (e2) = 1000; c-b: 500
    expect(out.perCrew).toEqual([
      { crewMemberId: "c-a", cents: 1000 },
      { crewMemberId: "c-b", cents: 500 },
    ]);
  });
});

// ── Report wiring ────────────────────────────────────────────────────────────
const CREW_A = asId<"CrewMemberId">("crew-a");
const CREW_B = asId<"CrewMemberId">("crew-b");
const SHIFT = asId<"ShiftId">("shift-1");
const VESSEL = asId<"VesselId">("v-1");
const CAPTAIN = asId<"RoleTypeId">("role-captain");

const crew = (id: typeof CREW_A, name: string, gusto?: CrewMember["gusto"]): CrewMember => ({
  id, name, phone: "+1", ratings: [CAPTAIN], status: "active", reliabilityScore: null,
  ...(gusto ? { gusto } : {}),
});
const seat = (id: string, assignedCrewMemberId: typeof CREW_A, over: Partial<Seat> = {}): Seat => ({
  id: asId<"SeatId">(id), shiftId: SHIFT, role: CAPTAIN, kind: "required", state: "Confirmed",
  assignedCrewMemberId, ...over,
});

async function seededRepo(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveCrewMember(crew(CREW_A, "Ann", { firstName: "Ann", lastName: "Alpha", title: "Captain", employeeId: "E1" }));
  await repo.saveCrewMember(crew(CREW_B, "Bob")); // no Gusto identity
  await repo.saveEvent({ id: evId("evt-1"), vesselId: VESSEL, date: "2026-07-04", time: "13:30", capacity: 12, status: "scheduled", source: "muster" });
  const shift: Shift = { id: SHIFT, vesselId: VESSEL, date: "2026-07-04", state: "Completed", eventIds: [evId("evt-1")] };
  await repo.saveShift(shift);
  await repo.saveSeat(seat("s-a", CREW_A));
  await repo.saveSeat(seat("s-b", CREW_B));
  await repo.saveReservation({ id: asId<"ReservationId">("resv-1"), eventId: evId("evt-1"), source: "muster", customerName: "X", partySize: 4, status: "booked" });
  await repo.saveGratuity(grat("grat_pre_cs1", "evt-1", 1000));
  return repo;
}
const WINDOW = { from: "2026-07-01", to: "2026-07-31" };

describe("buildGratuityPayroll — window + booked + seat denominator + Gusto", () => {
  it("splits a booked event's pool among its confirmed crew and joins Gusto identity", async () => {
    const repo = await seededRepo();
    const out = await buildGratuityPayroll(repo, WINDOW);
    expect(out.totalCents).toBe(1000);
    expect(out.rows).toEqual([
      { crewMemberId: "crew-a", name: "Ann", tipCents: 500, gusto: { firstName: "Ann", lastName: "Alpha", title: "Captain", employeeId: "E1" } },
      { crewMemberId: "crew-b", name: "Bob", tipCents: 500 },
    ]);
    // Bob has tips but no Gusto mapping → warned
    expect(out.warnings.some((w) => w.includes("Bob") && w.includes("no Gusto"))).toBe(true);
  });

  it("excludes gratuities outside the window", async () => {
    const repo = await seededRepo();
    const out = await buildGratuityPayroll(repo, { from: "2026-08-01", to: "2026-08-31" });
    expect(out.rows).toEqual([]);
    expect(out.totalCents).toBe(0);
  });

  it("excludes gratuities on a non-booked reservation", async () => {
    const repo = await seededRepo();
    await repo.saveReservation({ id: asId<"ReservationId">("resv-1"), eventId: evId("evt-1"), source: "muster", customerName: "X", partySize: 4, status: "cancelled" });
    const out = await buildGratuityPayroll(repo, WINDOW);
    expect(out.totalCents).toBe(0);
  });

  it("a cancelled shift takes its event out of scope (nobody paid)", async () => {
    const repo = await seededRepo();
    await repo.saveShift({ id: SHIFT, vesselId: VESSEL, date: "2026-07-04", state: "Cancelled", eventIds: [evId("evt-1")] });
    const out = await buildGratuityPayroll(repo, WINDOW);
    // the event is on no non-cancelled in-window shift → its gratuity is out of this period.
    expect(out.rows).toEqual([]);
    expect(out.totalCents).toBe(0);
  });
});

describe("gustoTipsCsv — the 15-column timesheet (lifted)", () => {
  it("emits the header + identity + paycheck_tips in dollars, other columns blank", () => {
    const rows: GustoTipRow[] = [
      { crewMemberId: "crew-a", name: "Ann", tipCents: 12475, gusto: { firstName: "Ann", lastName: "Alpha", title: "Captain", employeeId: "E1" } },
    ];
    const csv = gustoTipsCsv(rows);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("last_name,first_name,title,gusto_employee_id,regular_hours,overtime_hours,double_overtime_hours,missed_break_hours,bonus,commission,paycheck_tips,cash_tips,correction_payment,reimbursement,personal_note");
    // Alpha,Ann,Captain,E1, then 6 blanks, 124.75 (paycheck_tips), then 4 blanks
    expect(lines[1]).toBe("Alpha,Ann,Captain,E1,,,,,,,124.75,,,,");
  });

  it("excludes rows with no Gusto identity (they can't import)", () => {
    const rows: GustoTipRow[] = [{ crewMemberId: "crew-b", name: "Bob", tipCents: 500 }];
    expect(gustoTipsCsv(rows).trimEnd().split("\n")).toHaveLength(1); // header only
  });

  it("escapes a comma in an identity field (RFC-4180)", () => {
    const rows: GustoTipRow[] = [
      { crewMemberId: "c", name: "x", tipCents: 100, gusto: { firstName: "Al", lastName: "Smith, Jr", title: "Mate", employeeId: "E9" } },
    ];
    expect(gustoTipsCsv(rows)).toContain('"Smith, Jr",Al,Mate,E9');
  });
});
