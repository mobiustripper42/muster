/**
 * deriveMembers — the derived-not-snapshotted membership rule (#111, DEC-051).
 * Pure, no repo: the standing kinds read live shifts/seats/roster; DM reads the
 * persisted participant rows. The point of the test is that membership tracks the
 * schedule (a moved seat moves the cohort) and that dispatch is data-driven.
 */
import { describe, expect, it } from "vitest";
import type { CrewMember, Seat, Shift } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { Thread, ThreadKind } from "./entities.js";
import { deriveMembers, type MembershipContext } from "./membership.js";

const TENANT = asId<"TenantId">("tenant-x");
const CAPTAIN = asId<"RoleTypeId">("role-captain");

const crew = (id: string): CrewMember => ({
  id: asId<"CrewMemberId">(id),
  name: id,
  phone: "555",
  ratings: [CAPTAIN],
  status: "active",
  reliabilityScore: null,
});

const shift = (id: string, date: string): Shift => ({
  id: asId<"ShiftId">(id),
  vesselId: asId<"VesselId">("vessel-x"),
  date,
  state: "Filling",
  eventIds: [],
});

const seat = (id: string, shiftId: string, crewId?: string): Seat => ({
  id: asId<"SeatId">(id),
  shiftId: asId<"ShiftId">(shiftId),
  role: CAPTAIN,
  kind: "required",
  state: crewId ? "Claimed" : "Open",
  ...(crewId ? { assignedCrewMemberId: asId<"CrewMemberId">(crewId) } : {}),
});

const thread = (kind: ThreadKind, scopeRef: string | null): Thread => ({
  id: asId<"ThreadId">(`thread-${kind}`),
  tenantId: TENANT,
  kind,
  scopeRef,
  createdAt: "2026-07-01T12:00:00.000Z",
});

const empty: MembershipContext = {
  shifts: [],
  seats: [],
  roster: [],
  participants: [],
};

const ids = (xs: { toString(): string }[]): string[] => xs.map(String).sort();

describe("deriveMembers", () => {
  // Saturday: two boats. Brew-1 crewed by a+b; Brew-2 by c (+ an Open seat).
  // Sunday: Brew-1 by d. The cohort must gather a day across both boats.
  const ctx: MembershipContext = {
    shifts: [
      shift("sat-brew1", "2026-07-04"),
      shift("sat-brew2", "2026-07-04"),
      shift("sun-brew1", "2026-07-05"),
    ],
    seats: [
      seat("s1", "sat-brew1", "crew-a"),
      seat("s2", "sat-brew1", "crew-b"),
      seat("s3", "sat-brew2", "crew-c"),
      seat("s4", "sat-brew2"), // Open — no assignee, contributes nobody
      seat("s5", "sun-brew1", "crew-d"),
    ],
    roster: [crew("crew-a"), crew("crew-b"), crew("crew-c"), crew("crew-d")],
    participants: [],
  };

  it("shift: just that shift's assigned crew", () => {
    expect(ids(deriveMembers(thread("shift", "sat-brew1"), ctx))).toEqual([
      "crew-a",
      "crew-b",
    ]);
  });

  it("shift: an Open seat contributes nobody", () => {
    // sat-brew2 has one claimed (c) + one Open seat → only c.
    expect(ids(deriveMembers(thread("shift", "sat-brew2"), ctx))).toEqual([
      "crew-c",
    ]);
  });

  it("cohort: everyone crewing the DAY, across every shift that day", () => {
    // Saturday = both boats' crew (a, b, c) — NOT Sunday's d.
    expect(ids(deriveMembers(thread("cohort", "2026-07-04"), ctx))).toEqual([
      "crew-a",
      "crew-b",
      "crew-c",
    ]);
    expect(ids(deriveMembers(thread("cohort", "2026-07-05"), ctx))).toEqual([
      "crew-d",
    ]);
  });

  it("cohort tracks the schedule: reassign a seat, the cohort follows", () => {
    // The derived-not-snapshotted guarantee: move s1 from a → e, and Saturday's
    // cohort changes with no membership rewrite — that's the DEC-051 point.
    const moved: MembershipContext = {
      ...ctx,
      seats: ctx.seats.map((s) =>
        String(s.id) === "s1" ? seat("s1", "sat-brew1", "crew-e") : s,
      ),
      roster: [...ctx.roster, crew("crew-e")],
    };
    expect(ids(deriveMembers(thread("cohort", "2026-07-04"), moved))).toEqual([
      "crew-b",
      "crew-c",
      "crew-e",
    ]);
  });

  it("all_staff: the roster as given (no schedule needed)", () => {
    expect(ids(deriveMembers(thread("all_staff", null), ctx))).toEqual([
      "crew-a",
      "crew-b",
      "crew-c",
      "crew-d",
    ]);
  });

  it("dm: the persisted participants, not anything derived", () => {
    const t = thread("dm", null);
    const dmCtx: MembershipContext = {
      ...empty,
      participants: [
        { id: asId<"ParticipantId">("p1"), threadId: t.id, crewMemberId: asId<"CrewMemberId">("crew-a") },
        { id: asId<"ParticipantId">("p2"), threadId: t.id, crewMemberId: asId<"CrewMemberId">("crew-x") },
      ],
    };
    expect(ids(deriveMembers(t, dmCtx))).toEqual(["crew-a", "crew-x"]);
  });

  it("a crew member on two of the day's shifts is counted once", () => {
    const dbl: MembershipContext = {
      ...ctx,
      seats: [...ctx.seats, seat("s6", "sat-brew2", "crew-a")], // a is also on Brew-2
    };
    expect(ids(deriveMembers(thread("cohort", "2026-07-04"), dbl))).toEqual([
      "crew-a",
      "crew-b",
      "crew-c",
    ]);
  });

  it("empty context yields empty membership for every kind", () => {
    for (const k of ["shift", "cohort", "all_staff", "dm"] as ThreadKind[]) {
      expect(deriveMembers(thread(k, null), empty)).toEqual([]);
    }
  });
});
