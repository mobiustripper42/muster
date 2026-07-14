/**
 * Pure crew-eligibility rules — the four hard gates + status (§1.3, DEC-003).
 * (Task 1.4a / M3.)
 */

import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { RoleTypeId } from "../domain/ids.js";
import type { Credential, CrewMember, PtoWindow } from "../domain/entities.js";
import {
  evaluateCandidate,
  evaluateTraineeCandidate,
  hasRating,
  isActive,
  isAskableFor,
  mmcValidOnDate,
  notDoubleBooked,
  notOnPto,
  notRecurringOff,
} from "./eligibility.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");

const crew = (over: Partial<CrewMember> = {}): CrewMember => ({
  id: asId<"CrewMemberId">("crew-quint"),
  name: "Quint",
  phone: "555",
  ratings: [CAPTAIN],
  status: "active",
  reliabilityScore: null,
  ...over,
});

const cred = (type: string, expiry: string): Credential => ({
  id: asId<"CredentialId">(`cred-${type}-${expiry}`),
  crewMemberId: asId<"CrewMemberId">("crew-quint"),
  type,
  expiry,
});

const pto = (start: string, end: string): PtoWindow => ({
  id: asId<"PtoWindowId">(`pto-${start}`),
  crewMemberId: asId<"CrewMemberId">("crew-quint"),
  start,
  end,
});

describe("isActive", () => {
  it("passes active, fails inactive (§2.1)", () => {
    expect(isActive(crew()).passed).toBe(true);
    const r = isActive(crew({ status: "inactive" }));
    expect(r.passed).toBe(false);
    expect(r.details).toEqual({ status: "inactive" });
  });
});

describe("hasRating", () => {
  it("passes when ratings include the seat role", () => {
    expect(hasRating(crew({ ratings: [CAPTAIN, MATE] }), MATE).passed).toBe(true);
  });
  it("fails when the rating is missing, reporting required vs held", () => {
    const r = hasRating(crew({ ratings: [MATE] }), CAPTAIN);
    expect(r.passed).toBe(false);
    expect(r.details).toEqual({ required: CAPTAIN, held: [MATE] });
  });
});

describe("isAskableFor (#148, DEC-066) — captains aren't asked for mate seats", () => {
  it("a mate is askable for a mate seat", () => {
    expect(isAskableFor([MATE], MATE)).toBe(true);
  });
  it("a dual-rated captain is NOT askable for a mate seat (over-ranked)", () => {
    expect(isAskableFor([CAPTAIN, MATE], MATE)).toBe(false);
  });
  it("a captain is askable for a captain seat (nothing ranked above it)", () => {
    expect(isAskableFor([CAPTAIN, MATE], CAPTAIN)).toBe(true);
  });
  it("a mate is not askable for a captain seat (the upward block — not rated)", () => {
    expect(isAskableFor([MATE], CAPTAIN)).toBe(false);
  });
});

describe("mmcValidOnDate", () => {
  // Date-only ISO string (DEC-032: tz-invariant string comparison, no Date).
  const tripDate = "2026-07-01";

  it("passes when an MMC expires on or after the trip date", () => {
    expect(mmcValidOnDate([cred("MMC", "2026-12-31")], tripDate).passed).toBe(true);
  });
  it("treats expiry == trip date as still valid (boundary matches credential-health)", () => {
    expect(mmcValidOnDate([cred("MMC", "2026-07-01")], tripDate).passed).toBe(true);
  });
  it("fails when the MMC has lapsed before the trip date", () => {
    const r = mmcValidOnDate([cred("MMC", "2026-06-30")], tripDate);
    expect(r.passed).toBe(false);
    expect(r.details?.held).toEqual([{ type: "MMC", expiry: "2026-06-30" }]);
  });
  it("fails when no MMC is held — soft creds (medical) don't gate in v1", () => {
    const r = mmcValidOnDate([cred("medical", "2030-01-01")], tripDate);
    expect(r.passed).toBe(false);
    expect(r.details?.held).toEqual([]); // medical isn't a hard-gating type
  });
});

describe("notDoubleBooked", () => {
  it("fails when already committed on the trip date", () => {
    const r = notDoubleBooked(new Set(["2026-07-01"]), "2026-07-01");
    expect(r.passed).toBe(false);
    expect(r.details).toEqual({ conflictDate: "2026-07-01" });
  });
  it("passes when committed only on other dates", () => {
    expect(notDoubleBooked(new Set(["2026-07-02"]), "2026-07-01").passed).toBe(true);
  });
});

describe("notOnPto", () => {
  it("fails on the inclusive boundary of a window (DEC-009)", () => {
    expect(notOnPto([pto("2026-07-01", "2026-07-05")], "2026-07-01").passed).toBe(false);
    expect(notOnPto([pto("2026-07-01", "2026-07-05")], "2026-07-05").passed).toBe(false);
  });
  it("passes a date just outside the window", () => {
    expect(notOnPto([pto("2026-07-01", "2026-07-05")], "2026-07-06").passed).toBe(true);
  });
  it("passes with no windows (absence = available)", () => {
    expect(notOnPto([], "2026-07-01").passed).toBe(true);
  });
});

describe("notRecurringOff (#411, DEC-119 — Mon=0…Sun=6)", () => {
  // 2026-07-05 is a Sunday (weekday 6); 2026-07-01 a Wednesday (weekday 2).
  it("fails when the trip's weekday is in the blackout set", () => {
    const r = notRecurringOff([6], "2026-07-05");
    expect(r.passed).toBe(false);
    expect(r.details).toEqual({ weekday: 6 });
  });
  it("passes when the trip's weekday is not in the set", () => {
    expect(notRecurringOff([6], "2026-07-01").passed).toBe(true); // Wed trip, Sun off
  });
  it("passes on an empty set and on absent (never off)", () => {
    expect(notRecurringOff([], "2026-07-05").passed).toBe(true);
    expect(notRecurringOff(undefined, "2026-07-05").passed).toBe(true);
  });
});

describe("evaluateCandidate (collect-all)", () => {
  const ctx = (over: Partial<Parameters<typeof evaluateCandidate>[0]> = {}) => ({
    crew: crew(),
    credentials: [cred("MMC", "2026-12-31")],
    ptoWindows: [] as PtoWindow[],
    committedDates: new Set<string>(),
    ...over,
  });

  it("is eligible when every hard rule passes", () => {
    const v = evaluateCandidate(ctx(), CAPTAIN, "2026-07-01");
    expect(v.eligible).toBe(true);
    expect(v.failures).toEqual([]);
  });

  it("collects EVERY failure, not just the first (admin reschedule view)", () => {
    const v = evaluateCandidate(
      ctx({
        crew: crew({ status: "inactive", ratings: [MATE] }),
        credentials: [cred("MMC", "2025-01-01")],
        ptoWindows: [pto("2026-07-01", "2026-07-01")],
        committedDates: new Set(["2026-07-01"]),
      }),
      CAPTAIN,
      "2026-07-01",
    );
    expect(v.eligible).toBe(false);
    expect(v.failures.map((f) => f.ruleId).sort()).toEqual([
      "has_rating",
      "is_active",
      "mmc_valid_on_date",
      "not_double_booked",
      "not_on_pto",
    ]);
  });

  it("fails a recurring day-off, and only on that weekday (#411)", () => {
    const off = crew({ weekdaysOff: [6] }); // never works Sundays
    const sun = evaluateCandidate(ctx({ crew: off }), CAPTAIN, "2026-07-05");
    expect(sun.eligible).toBe(false);
    expect(sun.failures.map((f) => f.ruleId)).toContain("not_recurring_off");
    // Same crew on a Wednesday is fine.
    expect(evaluateCandidate(ctx({ crew: off }), CAPTAIN, "2026-07-01").eligible).toBe(true);
  });
});

describe("evaluateTraineeCandidate (#411 — trainees don't work their days off either)", () => {
  const trainee = crew({ ratings: [], weekdaysOff: [6] }); // unrated + never Sundays
  const base = {
    crew: trainee,
    credentials: [cred("MMC", "2026-12-31")],
    ptoWindows: [] as PtoWindow[],
    committedDates: new Set<string>(),
  };
  it("fails not_recurring_off on the blackout weekday", () => {
    const v = evaluateTraineeCandidate(base, "2026-07-05"); // Sunday
    expect(v.eligible).toBe(false);
    expect(v.failures.map((f) => f.ruleId)).toContain("not_recurring_off");
  });
  it("is eligible on other weekdays (no rating gate for trainees)", () => {
    expect(evaluateTraineeCandidate(base, "2026-07-01").eligible).toBe(true); // Wednesday
  });
});
