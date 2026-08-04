/**
 * Hours report (13.4, #628, SPEC §2.9.6) — what actually goes to payroll.
 *
 * The two tests that matter most are the bucketing ones. Everything else here is arithmetic;
 * those two are the difference between a correct paycheck and a quietly wrong one, and neither
 * failure has any visible symptom — the number just comes out short, in a period nobody is
 * looking at any more.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, TimePunch } from "../domain/entities.js";
import { buildTimeClockReport } from "./time-clock-report.js";

const QUINT = asId<"CrewMemberId">("crew-quint");
const HOOPER = asId<"CrewMemberId">("crew-hooper");

const crew = (id: string, name: string): CrewMember => ({
  id: asId<"CrewMemberId">(id),
  name,
  phone: "+15035550100",
  ratings: [asId<"RoleTypeId">("role-captain")],
  status: "active",
  reliabilityScore: null,
});

let seq = 0;
const punch = (p: {
  crew?: ReturnType<typeof asId<"CrewMemberId">>;
  inAt: string;
  outAt?: string | null;
  origin?: TimePunch["origin"];
  adminEditedAt?: string | null;
}): TimePunch => ({
  id: asId<"TimePunchId">(`punch-${++seq}`),
  crewMemberId: p.crew ?? QUINT,
  inAt: p.inAt,
  outAt: p.outAt ?? null,
  shiftId: null,
  origin: p.origin ?? "crew",
  adminEditedAt: p.adminEditedAt ?? null,
});

async function repoWith(punches: TimePunch[], members = [crew("crew-quint", "Quint")]) {
  const repo = new InMemoryRepository();
  for (const m of members) await repo.saveCrewMember(m);
  for (const p of punches) await repo.saveTimePunch(p);
  return repo;
}

/** The tenant zone is America/New_York (`TENANT_TIMEZONE`), so EDT = UTC-4 in summer. */
describe("period bucketing is vessel-local, never UTC (§2.9.6)", () => {
  it("an 8pm-Eastern punch on the LAST day of a period lands in THAT period", async () => {
    // 2026-07-19 20:00 EDT === 2026-07-20T00:00Z. Bucketing on the UTC date would file these
    // hours under the 20th — the first day of the NEXT period — and the person's paycheck would
    // be short by a shift, in the direction that looks like they worked less.
    const repo = await repoWith([
      punch({ inAt: "2026-07-20T00:00:00Z", outAt: "2026-07-20T03:00:00Z" }),
    ]);

    const inPeriod = await buildTimeClockReport(repo, { from: "2026-07-06", to: "2026-07-19" });
    expect(inPeriod.rows).toHaveLength(1);
    expect(inPeriod.rows[0]!.minutes).toBe(180);

    const nextPeriod = await buildTimeClockReport(repo, { from: "2026-07-20", to: "2026-08-02" });
    expect(nextPeriod.rows).toHaveLength(0);
  });

  it("a punch at 8pm Eastern on the day BEFORE a period does not leak into it", async () => {
    // The mirror: 2026-07-05 20:00 EDT is already the 6th in UTC. A UTC bucket would pull it
    // FORWARD into the period, paying it twice across two reports.
    const repo = await repoWith([
      punch({ inAt: "2026-07-06T00:00:00Z", outAt: "2026-07-06T02:00:00Z" }),
    ]);
    const report = await buildTimeClockReport(repo, { from: "2026-07-06", to: "2026-07-19" });
    expect(report.rows).toHaveLength(0);
  });

  it("a punch spanning the DST fall-back reports TRUE elapsed minutes, not wall-clock", async () => {
    // 2026-11-01: clocks go back at 2am Eastern, so 01:00 EDT → 05:00 EST is FIVE real hours
    // while the wall clock advances four. Both ends are instants, so elapsed is exact (§2.9.1).
    const repo = await repoWith([
      punch({ inAt: "2026-11-01T05:00:00Z", outAt: "2026-11-01T10:00:00Z" }),
    ]);
    const report = await buildTimeClockReport(repo, { from: "2026-10-26", to: "2026-11-08" });
    expect(report.rows[0]!.minutes).toBe(300);
  });
});

describe("open punches are excluded and counted, never estimated (§2.9.5/§2.9.6)", () => {
  it("contributes zero minutes and one to openCount", async () => {
    const repo = await repoWith([
      punch({ inAt: "2026-07-07T13:00:00Z", outAt: "2026-07-07T18:00:00Z" }),
      punch({ inAt: "2026-07-08T13:00:00Z" }), // still on the clock
    ]);
    const report = await buildTimeClockReport(repo, { from: "2026-07-06", to: "2026-07-19" });

    expect(report.rows[0]!.minutes).toBe(300);
    expect(report.rows[0]!.openCount).toBe(1);
    // punchCount counts what CONTRIBUTED — an open punch has no hours to count.
    expect(report.rows[0]!.punchCount).toBe(1);
  });

  it("surfaces a report-level openCount so the surface can gate the export", async () => {
    const repo = await repoWith(
      [punch({ inAt: "2026-07-07T13:00:00Z" }), punch({ crew: HOOPER, inAt: "2026-07-08T13:00:00Z" })],
      [crew("crew-quint", "Quint"), crew("crew-hooper", "Hooper")],
    );
    const report = await buildTimeClockReport(repo, { from: "2026-07-06", to: "2026-07-19" });
    expect(report.openCount).toBe(2);
  });
});

describe("exact minutes, no rounding (§2.9.6)", () => {
  it("keeps the odd seconds rather than rounding to a quarter hour", async () => {
    // 2h 37m 43s. Muster has NO rounding policy in either direction; the payroll company
    // applies its own, and one rounding step is auditable where two compounded are not.
    const repo = await repoWith([
      punch({ inAt: "2026-07-07T13:00:00Z", outAt: "2026-07-07T15:37:43Z" }),
    ]);
    const report = await buildTimeClockReport(repo, { from: "2026-07-06", to: "2026-07-19" });
    expect(report.rows[0]!.minutes).toBeCloseTo(157 + 43 / 60, 5);
  });
});

describe("provenance is carried through to the report (§2.9.8)", () => {
  it("counts admin-entered and admin-edited punches separately", async () => {
    const repo = await repoWith([
      punch({ inAt: "2026-07-07T13:00:00Z", outAt: "2026-07-07T14:00:00Z", origin: "admin" }),
      punch({
        inAt: "2026-07-08T13:00:00Z",
        outAt: "2026-07-08T14:00:00Z",
        adminEditedAt: "2026-07-09T10:00:00Z",
      }),
      punch({ inAt: "2026-07-09T13:00:00Z", outAt: "2026-07-09T14:00:00Z" }),
    ]);
    const report = await buildTimeClockReport(repo, { from: "2026-07-06", to: "2026-07-19" });
    expect(report.rows[0]!.adminEnteredCount).toBe(1);
    expect(report.rows[0]!.adminEditedCount).toBe(1);
    // Hours nobody actually punched must never look identical to hours they did.
    expect(report.rows[0]!.touchedByAdmin).toBe(true);
  });

  it("is false when every punch was tapped by its owner", async () => {
    const repo = await repoWith([
      punch({ inAt: "2026-07-07T13:00:00Z", outAt: "2026-07-07T14:00:00Z" }),
    ]);
    const report = await buildTimeClockReport(repo, { from: "2026-07-06", to: "2026-07-19" });
    expect(report.rows[0]!.touchedByAdmin).toBe(false);
  });
});

describe("shape", () => {
  it("sorts by name and resolves names once", async () => {
    const repo = await repoWith(
      [
        punch({ crew: QUINT, inAt: "2026-07-07T13:00:00Z", outAt: "2026-07-07T14:00:00Z" }),
        punch({ crew: HOOPER, inAt: "2026-07-07T13:00:00Z", outAt: "2026-07-07T14:00:00Z" }),
      ],
      [crew("crew-quint", "Quint"), crew("crew-hooper", "Hooper")],
    );
    const report = await buildTimeClockReport(repo, { from: "2026-07-06", to: "2026-07-19" });
    expect(report.rows.map((r) => r.name)).toEqual(["Hooper", "Quint"]);
  });

  it("renders a punch whose crew id resolves to nobody rather than dropping the hours", async () => {
    // Punches deliberately carry no FK (they outlive crew rows — §2.9 edge cases). Hours already
    // worked are still owed, so an unresolvable id must not silently vanish from payroll.
    const repo = await repoWith(
      [punch({ crew: asId<"CrewMemberId">("crew-ghost"), inAt: "2026-07-07T13:00:00Z", outAt: "2026-07-07T14:00:00Z" })],
      [],
    );
    const report = await buildTimeClockReport(repo, { from: "2026-07-06", to: "2026-07-19" });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.minutes).toBe(60);
    expect(report.rows[0]!.name).toBeNull();
  });
});
