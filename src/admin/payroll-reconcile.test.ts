/**
 * Payroll reconcile (13.4, #628) — the estimate and the punch clock side by side, plus the ONE
 * Gusto file carrying both hours and tips.
 *
 * Two behaviours here are the point of the task and everything else is plumbing:
 *
 * 1. **The union.** A person with an estimate and no punches, and a person with punches and no
 *    estimate, are exactly the disagreements this surface exists to show. Either one dropped is
 *    the surface hiding its own reason for existing.
 * 2. **An open punch BLOCKS the export** (operator, 2026-08-02). Not a warning on a file that
 *    goes out anyway — the file does not go out.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, Event, Seat, Shift, TimePunch } from "../domain/entities.js";
import {
  buildPayrollReconcile,
  gustoPayrollCsv,
  EXPORT_BLOCKED_MESSAGE,
} from "./payroll-reconcile.js";

const CAP = asId<"RoleTypeId">("role-captain");
const V = asId<"VesselId">("vessel-1");
const WINDOW = { from: "2026-07-06", to: "2026-07-19" };

const crew = (id: string, name: string, gusto?: CrewMember["gusto"]): CrewMember => ({
  id: asId<"CrewMemberId">(id),
  name,
  phone: "+15035550100",
  ratings: [CAP],
  status: "active",
  reliabilityScore: null,
  ...(gusto ? { gusto } : {}),
});

const gusto = (employeeId: string, firstName: string, lastName: string) => ({
  firstName,
  lastName,
  title: "Captain",
  employeeId,
});

let seq = 0;
const punch = (crewId: string, inAt: string, outAt: string | null): TimePunch => ({
  id: asId<"TimePunchId">(`punch-${++seq}`),
  crewMemberId: asId<"CrewMemberId">(crewId),
  inAt,
  outAt,
  shiftId: null,
  origin: "crew",
  adminEditedAt: null,
});

/** A Confirmed required seat on a one-trip shift — the estimate side. */
async function seedEstimate(repo: InMemoryRepository, crewId: string, date: string, time: string) {
  const eventId = asId<"EventId">(`ev-${crewId}-${date}-${time}`);
  const shiftId = asId<"ShiftId">(`sh-${crewId}-${date}-${time}`);
  const event: Event = { id: eventId, vesselId: V, date, time, capacity: 6, status: "scheduled", source: "xola" };
  const shift: Shift = { id: shiftId, vesselId: V, date, state: "Crewed", eventIds: [eventId] };
  const seat: Seat = {
    id: asId<"SeatId">(`seat-${crewId}-${date}-${time}`),
    shiftId,
    role: CAP,
    kind: "required",
    state: "Confirmed",
    assignedCrewMemberId: asId<"CrewMemberId">(crewId),
  };
  await repo.saveEvent(event);
  await repo.saveShift(shift);
  await repo.saveSeat(seat);
}

describe("the reconcile table is a UNION of both sides (#628)", () => {
  it("keeps a crew member who has an estimate but never punched", async () => {
    // The silent-zero case: they held a Confirmed seat, worked, and clocked nothing. Dropping
    // the row means the CSV is short a whole person and nothing on screen says so.
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-quint", "Quint"));
    await seedEstimate(repo, "crew-quint", "2026-07-07", "13:00");

    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.estimateMinutes).toBeGreaterThan(0);
    expect(r.rows[0]!.actualMinutes).toBe(0);
  });

  it("keeps a crew member who punched but holds no Confirmed seat", async () => {
    // Maintenance, a covered shift nobody re-seated, an unscheduled day. Hours are owed whether
    // or not the schedule can explain them (§2.9.2).
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-hooper", "Hooper"));
    await repo.saveTimePunch(punch("crew-hooper", "2026-07-07T13:00:00Z", "2026-07-07T18:00:00Z"));

    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.estimateMinutes).toBe(0);
    expect(r.rows[0]!.actualMinutes).toBe(300);
  });

  it("reports the delta so the disagreement is the thing you read", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-quint", "Quint"));
    await seedEstimate(repo, "crew-quint", "2026-07-07", "13:00");
    await repo.saveTimePunch(punch("crew-quint", "2026-07-07T13:00:00Z", "2026-07-07T18:00:00Z"));

    const r = await buildPayrollReconcile(repo, WINDOW);
    const row = r.rows[0]!;
    expect(row.deltaMinutes).toBe(row.actualMinutes - row.estimateMinutes);
  });

  it("sorts by name, nameless last", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-quint", "Quint"));
    await repo.saveCrewMember(crew("crew-brody", "Brody"));
    await repo.saveTimePunch(punch("crew-quint", "2026-07-07T13:00:00Z", "2026-07-07T14:00:00Z"));
    await repo.saveTimePunch(punch("crew-brody", "2026-07-07T13:00:00Z", "2026-07-07T14:00:00Z"));
    await repo.saveTimePunch(punch("crew-ghost", "2026-07-07T13:00:00Z", "2026-07-07T14:00:00Z"));

    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.rows.map((x) => x.name)).toEqual(["Brody", "Quint", null]);
  });
});

describe("an open punch blocks the export (§2.9.6, operator 2026-08-02)", () => {
  it("flags the period and names who is still on the clock", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-quint", "Quint"));
    await repo.saveTimePunch(punch("crew-quint", "2026-07-07T13:00:00Z", null));

    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.openCount).toBe(1);
    expect(r.exportBlocked).toBe(true);
    expect(r.rows[0]!.openCount).toBe(1);
  });

  it("REFUSES to build the CSV rather than emitting a short one", async () => {
    // The whole point. A warning on a file that still downloads is a file that still gets sent.
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-quint", "Quint", gusto("E1", "Sam", "Quint")));
    await repo.saveTimePunch(punch("crew-quint", "2026-07-07T13:00:00Z", "2026-07-07T18:00:00Z"));
    await repo.saveTimePunch(punch("crew-quint", "2026-07-08T13:00:00Z", null));

    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(() => gustoPayrollCsv(r)).toThrow(EXPORT_BLOCKED_MESSAGE);
  });

  it("builds once every punch is closed", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-quint", "Quint", gusto("E1", "Sam", "Quint")));
    await repo.saveTimePunch(punch("crew-quint", "2026-07-07T13:00:00Z", "2026-07-07T18:00:00Z"));

    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.exportBlocked).toBe(false);
    expect(() => gustoPayrollCsv(r)).not.toThrow();
  });
});

describe("one Gusto file carries hours AND tips", () => {
  it("puts regular_hours and paycheck_tips on the same row", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-quint", "Quint", gusto("E1042", "Sam", "Quint")));
    await repo.saveTimePunch(punch("crew-quint", "2026-07-07T13:00:00Z", "2026-07-07T18:00:00Z"));

    const csv = gustoPayrollCsv(await buildPayrollReconcile(repo, WINDOW));
    const [header, row] = csv.trim().split("\n");
    const cols = header!.split(",");
    const vals = row!.split(",");

    expect(vals[cols.indexOf("gusto_employee_id")]).toBe("E1042");
    expect(vals[cols.indexOf("regular_hours")]).toBe("5.00");
    expect(vals[cols.indexOf("paycheck_tips")]).toBe("0.00");
  });

  it("excludes crew with no Gusto mapping, and warns rather than emitting a keyless row", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-quint", "Quint")); // no gusto identity
    await repo.saveTimePunch(punch("crew-quint", "2026-07-07T13:00:00Z", "2026-07-07T18:00:00Z"));

    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.warnings.join(" ")).toMatch(/Quint/);
    expect(gustoPayrollCsv(r).trim().split("\n")).toHaveLength(1); // header only
  });

  it("emits a row for someone with tips and no hours", async () => {
    // Tips are earned on a trip; the hours may sit in another period, or the punch may be
    // missing. Dropping the row would silently withhold money that is already owed.
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-quint", "Quint", gusto("E1", "Sam", "Quint")));
    await seedEstimate(repo, "crew-quint", "2026-07-07", "13:00");

    const r = await buildPayrollReconcile(repo, WINDOW);
    // No punches at all ⇒ nothing open ⇒ the file builds; the row just carries zero hours.
    expect(r.exportBlocked).toBe(false);
    expect(gustoPayrollCsv(r).trim().split("\n")).toHaveLength(2);
  });

  it("truncates hours at the file edge rather than inflating them", async () => {
    // 2h37m43s = 2.6286h. The file needs A decimal, so precision is lost exactly ONCE, here,
    // and DOWNWARD — the same call #626 made for the crew surface. Muster still stores and
    // reconciles exact minutes (§2.9.6); this is the payroll company's unit, not our policy.
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-quint", "Quint", gusto("E1", "Sam", "Quint")));
    await repo.saveTimePunch(punch("crew-quint", "2026-07-07T13:00:00Z", "2026-07-07T15:37:43Z"));

    const csv = gustoPayrollCsv(await buildPayrollReconcile(repo, WINDOW));
    const cols = csv.trim().split("\n")[0]!.split(",");
    const vals = csv.trim().split("\n")[1]!.split(",");
    expect(vals[cols.indexOf("regular_hours")]).toBe("2.62"); // not 2.63
  });
});
