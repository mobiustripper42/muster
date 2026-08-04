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
  decimalHoursForTest,
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

  it("does not lose a cent to floating point — 69 minutes is exactly 1.15h", async () => {
    // `(69 / 60) * 100` is 114.99999999999999, so flooring it emitted "1.14" for a value that
    // is exactly 1.15. Not the deliberate sub-cent truncation §2.9.6 describes — an EXTRA cent,
    // lost to representation, in the column Gusto pays from. It hit ~2.3% of whole-minute
    // totals, always downward, always silently. Caught by @code-review; found by nobody's
    // arithmetic on screen, because there is none.
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-quint", "Quint", gusto("E1", "Sam", "Quint")));
    await repo.saveTimePunch(punch("crew-quint", "2026-07-07T13:00:00Z", "2026-07-07T14:09:00Z"));

    const csv = gustoPayrollCsv(await buildPayrollReconcile(repo, WINDOW));
    const cols = csv.trim().split("\n")[0]!.split(",");
    const vals = csv.trim().split("\n")[1]!.split(",");
    expect(vals[cols.indexOf("regular_hours")]).toBe("1.15");
  });

  it("agrees with exact rational arithmetic across every whole-minute total", async () => {
    // The single case above pins the bug; this pins the CLASS. Hours are m/60, so the exact
    // hundredths are floor(m * 5 / 3) — integer arithmetic with no representation to get wrong.
    // A sweep is worth it here because the failures are scattered (69, 123, 138, 153, 246…)
    // rather than clustered, so any handful of hand-picked cases would have missed most of them.
    for (let m = 0; m <= 20_000; m++) {
      const exact = (Math.floor((m * 5) / 3) / 100).toFixed(2);
      expect(decimalHoursForTest(m), `${m} minutes`).toBe(exact);
    }
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

/**
 * A Confirmed seat with no punch (#638). 13.3's bench catches punches that are WRONG; it
 * cannot catch the punch that isn't there. That person's hours are silently zero and the file
 * that goes to payroll is short a whole shift for a whole person.
 *
 * **Counted, never blocking** (operator, 2026-08-03). An open punch blocks the export because
 * a human closing it always clears the block. A missing punch has no such action — the person
 * may genuinely not have worked — so blocking payroll for the whole crew on one no-show would
 * leave the operator stuck with nothing to do about it.
 */
async function seedSeat(
  repo: InMemoryRepository,
  crewId: string,
  date: string,
  time: string,
  opts: { kind?: "required" | "supernumerary"; shiftState?: "Crewed" | "Cancelled" } = {},
) {
  const key = `${crewId}-${date}-${time}`;
  const eventId = asId<"EventId">(`ev2-${key}`);
  const shiftId = asId<"ShiftId">(`sh2-${key}`);
  await repo.saveEvent({
    id: eventId, vesselId: V, date, time, capacity: 6, status: "scheduled", source: "xola",
  });
  await repo.saveShift({
    id: shiftId, vesselId: V, date, state: opts.shiftState ?? "Crewed", eventIds: [eventId],
  });
  await repo.saveSeat({
    id: asId<"SeatId">(`seat2-${key}`),
    shiftId,
    role: CAP,
    kind: opts.kind ?? "required",
    state: "Confirmed",
    assignedCrewMemberId: asId<"CrewMemberId">(crewId),
  });
}

describe("a Confirmed seat with no punch is reported as missing (#638)", () => {
  it("counts the day a seated crew member never punched", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-brody", "Brody"));
    await seedSeat(repo, "crew-brody", "2026-07-07", "13:00");

    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.rows[0]!.missingDays).toEqual(["2026-07-07"]);
    expect(r.missingCount).toBe(1);
  });

  it("does NOT block the export — that is what separates it from an open punch", async () => {
    // The whole design decision in one assertion. A missing day has no action guaranteed to
    // clear it, so gating the file on it would strand the operator.
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-brody", "Brody", gusto("E-1", "Martin", "Brody")));
    await seedSeat(repo, "crew-brody", "2026-07-07", "13:00");

    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.missingCount).toBe(1);
    expect(r.exportBlocked).toBe(false);
    expect(() => gustoPayrollCsv(r)).not.toThrow();
  });

  it("a day with ANY punch is not missing — including an OPEN one", async () => {
    // Open and missing are different problems. Double-reporting one day as both would have the
    // operator chasing a punch that exists and is merely unfinished.
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-hooper", "Hooper"));
    await seedSeat(repo, "crew-hooper", "2026-07-07", "13:00");
    await repo.saveTimePunch(punch("crew-hooper", "2026-07-07T13:00:00Z", null));

    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.rows[0]!.openCount).toBe(1);
    expect(r.rows[0]!.missingDays).toEqual([]);
    expect(r.missingCount).toBe(0);
  });

  it("a supernumerary seat is never missing — an unpaid ride owes no hours", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-trainee", "Trainee"));
    await seedSeat(repo, "crew-trainee", "2026-07-07", "13:00", { kind: "supernumerary" });

    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.missingCount).toBe(0);
  });

  it("a Cancelled shift is never missing — the work did not happen", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-brody", "Brody"));
    await seedSeat(repo, "crew-brody", "2026-07-07", "13:00", { shiftState: "Cancelled" });

    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.missingCount).toBe(0);
  });

  it("buckets the punch VESSEL-LOCALLY before deciding a day is empty (DEC-032)", async () => {
    // 2026-07-08T00:30Z is 20:30 Eastern on 07-07. Read as UTC it lands on the 8th, leaving the
    // 7th looking unpunched — inventing a missing shift for someone who worked an evening trip.
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-brody", "Brody"));
    await seedSeat(repo, "crew-brody", "2026-07-07", "18:00");
    await repo.saveTimePunch(punch("crew-brody", "2026-07-08T00:30:00Z", "2026-07-08T03:00:00Z"));

    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.rows[0]!.missingDays).toEqual([]);
    expect(r.missingCount).toBe(0);
  });

  it("counts each missing DAY, not each missing person", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-brody", "Brody"));
    await seedSeat(repo, "crew-brody", "2026-07-07", "13:00");
    await seedSeat(repo, "crew-brody", "2026-07-09", "13:00");
    await repo.saveTimePunch(punch("crew-brody", "2026-07-09T13:00:00Z", "2026-07-09T18:00:00Z"));

    const r = await buildPayrollReconcile(repo, WINDOW);
    expect(r.rows[0]!.missingDays).toEqual(["2026-07-07"]);
    expect(r.missingCount).toBe(1);
  });
});
