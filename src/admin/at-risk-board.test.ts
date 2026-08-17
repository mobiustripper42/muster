/**
 * At-Risk board derivation (#41, SPEC §2.5, DEC-025).
 *
 * Ordering tests are ORDINAL by design (the @architect pass): they assert who
 * sorts above whom (sooner beats later; regression beats never-filled at
 * similar time-to-trip; thinner pool beats deeper), never exact scores — so
 * tuning the urgency weights later doesn't shatter the suite.
 *
 * Some scenarios seed seat states directly (e.g. a resting `Bailed` seat —
 * occupant cleared, matching what `bail()` actually leaves behind) rather than
 * driving the full ask loop — this suite tests the pure read-model over
 * states, not loop reachability (escalate/bail have their own suites).
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId, ShiftId } from "../domain/ids.js";
import type {
  Credential,
  CrewMember,
  Event,
  Seat,
  Shift,
} from "../domain/entities.js";
import type { SeatState, ShiftState } from "../domain/states.js";
import {
  bail,
  broadcastAsk,
  confirmSeat,
  expireAsks,
  recordResponse,
} from "../asks/ask-loop.js";
import { bailLatenessMs, FILL_DEADLINE_HOURS } from "../builder/derive.js";
import { logShiftBailed } from "../oracle/reliability-log.js";
import { deriveAtRiskBoard, EXHAUSTED_THRESHOLD_HOURS } from "./at-risk-board.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");

/** The board's "now" for every scenario. */
const T0 = new Date("2026-07-01T12:00:00.000Z");
const hoursAfterT0 = (h: number) => new Date(T0.getTime() + h * 3600_000);

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

async function addCrew(
  id: string,
  over: Partial<CrewMember> = {},
  mmcExpiry = "2026-12-31",
): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name: id,
    phone: "555",
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
    ...over,
  });
  const cred: Credential = {
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: crewId,
    type: "MMC",
    expiry: mmcExpiry,
  };
  await repo.saveCredential(cred);
  return crewId;
}

interface SeatSpec {
  role?: typeof CAPTAIN | typeof MATE;
  state?: SeatState;
  assigned?: CrewMemberId;
}

/**
 * One shift + its event (departing `tripAt`) + required seats. The event makes
 * the horizon and trip-start real; lead is the default 7 days, so every trip
 * inside a week is past its horizon at T0.
 */
async function addShift(
  id: string,
  tripAt: Date,
  seatSpecs: SeatSpec[],
  state: ShiftState = "Filling",
): Promise<{ shiftId: ShiftId; seatIds: SeatId[] }> {
  const shiftId = asId<"ShiftId">(id);
  const vesselId = asId<"VesselId">(`vessel-${id}`);
  const date = tripAt.toISOString().slice(0, 10);
  const eventId = asId<"EventId">(`event-${id}`);
  const event: Event = {
    id: eventId,
    vesselId,
    date,
    time: tripAt.toISOString().slice(11, 16),
    capacity: 6,
    source: "xola", status: "scheduled",
  };
  await repo.saveEvent(event);
  const shift: Shift = { id: shiftId, vesselId, date, state, eventIds: [eventId] };
  await repo.saveShift(shift);
  const seatIds: SeatId[] = [];
  for (const [i, spec] of seatSpecs.entries()) {
    const seatId = asId<"SeatId">(`seat-${id}-${i + 1}`);
    const seat: Seat = {
      id: seatId,
      shiftId,
      role: spec.role ?? CAPTAIN,
      kind: "required",
      state: spec.state ?? "Open",
      ...(spec.assigned ? { assignedCrewMemberId: spec.assigned } : {}),
    };
    await repo.saveSeat(seat);
    seatIds.push(seatId);
  }
  return { shiftId, seatIds };
}

/** Broadcast a seat at T0, then have every recipient decline. */
async function broadcastAllDecline(seatId: SeatId): Promise<number> {
  const asks = await broadcastAsk(repo, seatId, T0);
  for (const ask of asks) await recordResponse(repo, ask.id, "declined", T0);
  return asks.length;
}

describe("past-trip guard (#147, DEC-062)", () => {
  it("a departed shift never boards, even short + willingness-exhausted", async () => {
    await addCrew("ann");
    // Trip departed 24h before the board's `now`; whole pool declined → this
    // WOULD board on willingness-exhaustion if it weren't past. The guard drops
    // it so Spink isn't pinged about a trip that already left the dock.
    const { shiftId, seatIds } = await addShift("past1", hoursAfterT0(-24), [{}]);
    await broadcastAllDecline(seatIds[0]!);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).not.toContain(shiftId);
    expect(rows).toHaveLength(0);
  });
});

describe("membership — core (imminence / route (b), DEC-065)", () => {
  it("boards a still-short shift whose whole pool declined, trip inside the threshold", async () => {
    await addCrew("ann");
    await addCrew("bob");
    const { shiftId, seatIds } = await addShift("w1", hoursAfterT0(24), [{}]);
    const asked = await broadcastAllDecline(seatIds[0]!);
    expect(asked).toBe(2);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    const row = rows[0]!;
    expect(row.reasons).toEqual(["core"]);
    expect(row.resolvedState).toBe("Filling"); // eligibility ≠ willingness
    expect(row.trail.asked).toBe(2);
    expect(row.trail.declined).toBe(2);
    expect(row.gaps).toEqual([{ role: CAPTAIN, missing: 1 }]);
  });

  it("boards on all-silent the same as all-declined (the ghosted broadcast)", async () => {
    await addCrew("ann");
    const { seatIds } = await addShift("w2", hoursAfterT0(24), [{}]);
    await broadcastAsk(repo, seatIds[0]!, T0);
    await expireAsks(repo, seatIds[0]!, hoursAfterT0(12), 3600_000);

    const rows = await deriveAtRiskBoard(repo, hoursAfterT0(12));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trail.silent).toBe(1);
    expect(rows[0]!.reasons).toEqual(["core"]);
  });

  it("boards an uncrewed shift even with a live ask in flight (DEC-065 — no hide-while-working)", async () => {
    await addCrew("ann");
    const { shiftId, seatIds } = await addShift("w3", hoursAfterT0(24), [{}]);
    await broadcastAsk(repo, seatIds[0]!, T0); // ann mid-decision — the ask is pending

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.reasons).toEqual(["core"]);
    expect(rows[0]!.resolvedState).toBe("Filling");
    expect(rows[0]!.trail.pending).toBe(1); // the live ask that USED to hide it
  });

  it("does NOT board a still-Filling shift whose trip is still far out", async () => {
    await addCrew("ann");
    const farOut = hoursAfterT0(EXHAUSTED_THRESHOLD_HOURS + 100);
    const { seatIds } = await addShift("w4", farOut, [{}]);
    await broadcastAllDecline(seatIds[0]!);

    expect(await deriveAtRiskBoard(repo, T0)).toEqual([]);
  });

  it("boards at exactly the threshold — the deadline bound is inclusive", async () => {
    await addCrew("ann");
    const atBound = hoursAfterT0(EXHAUSTED_THRESHOLD_HOURS);
    const { shiftId, seatIds } = await addShift("w6", atBound, [{}]);
    await broadcastAllDecline(seatIds[0]!);

    // tz: "UTC" — the helper mints events from a UTC Date, so UTC interpretation
    // keeps the boundary exactly EXHAUSTED_THRESHOLD_HOURS from T0 (DEC-032).
    const rows = await deriveAtRiskBoard(repo, T0, { tz: "UTC" });
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
  });

  it("boards a never-asked uncrewed shift inside the threshold (DEC-065 — visible before the engine even asks)", async () => {
    await addCrew("ann");
    const { shiftId } = await addShift("w5", hoursAfterT0(24), [{}]);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.reasons).toEqual(["core"]);
    expect(rows[0]!.trail.asked).toBe(0); // not asked yet — on the board anyway
    expect(rows[0]!.resolvedState).toBe("Filling");
  });

  it("does NOT board a Claimed-but-unconfirmed seat inside the threshold — gapSeats is the sole guard now (DEC-065)", async () => {
    const yes = await addCrew("ann");
    // Someone already said yes, awaiting confirm — not a hole to fill. With the
    // asked/pending gate gone, `gapSeats` excluding Claimed is the ONLY thing
    // keeping this actively-progressing shift from summoning Spink.
    await addShift("cl1", hoursAfterT0(24), [{ state: "Claimed", assigned: yes }]);

    expect(await deriveAtRiskBoard(repo, T0)).toEqual([]);
  });
});

describe("membership — core (eligibility-exhaustion, no threshold)", () => {
  it("boards an unfillable shift even days out — the engine already declared it", async () => {
    // Only crew is mate-rated; the captain seat has an empty pool. Trip is 6
    // days out (past horizon, way outside the 48h willingness threshold).
    await addCrew("mia", { ratings: [MATE] });
    const { shiftId } = await addShift("e1", hoursAfterT0(6 * 24), [{}]);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.resolvedState).toBe("AtRisk");
    expect(rows[0]!.reasons).toEqual(["core"]);
    expect(rows[0]!.trail.exhausted).toBe(true);
  });

  it("boards the empty-pool-from-birth shift (no takers at all, asked === 0)", async () => {
    const { shiftId } = await addShift("e2", hoursAfterT0(24), [{}]);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.trail.asked).toBe(0);
    expect(rows[0]!.available).toEqual([]);
  });

  it("does NOT board a pre-horizon shift — crew rules abstain before the horizon", async () => {
    // Trip 10 days out with the default 7-day lead: horizon not reached, the
    // shift resolves Pending even though its pool is empty today.
    await addShift("e3", hoursAfterT0(10 * 24), [{}]);

    expect(await deriveAtRiskBoard(repo, T0)).toEqual([]);
  });
});

describe("membership — regression and credential-lapse", () => {
  it("flags a rested-Bailed seat as regression (and core, via resolved AtRisk)", async () => {
    await addCrew("ghost");
    const { shiftId } = await addShift("r1", hoursAfterT0(24), [
      { state: "Bailed" },
    ]);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.reasons).toContain("regression");
    expect(rows[0]!.resolvedState).toBe("AtRisk");
  });

  it("flags a credential lapse on a Claimed (yes, unconfirmed) occupant too", async () => {
    const lapsing = await addCrew("lapsing2", {}, "2026-07-02"); // trip is 07-04
    const { shiftId } = await addShift("c3", hoursAfterT0(3 * 24), [
      { state: "Claimed", assigned: lapsing },
    ]);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.reasons).toContain("credential_lapse");
  });

  it("flags a fully-Crewed shift whose confirmed captain's MMC lapses before the trip", async () => {
    const lapsing = await addCrew("lapsing", {}, "2026-07-02"); // trip is 07-04
    const { shiftId } = await addShift("c1", hoursAfterT0(3 * 24), [
      { state: "Confirmed", assigned: lapsing },
    ]);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.reasons).toEqual(["credential_lapse"]);
    expect(rows[0]!.resolvedState).toBe("Crewed");
    expect(rows[0]!.gaps).toEqual([]); // nothing to fill — the body is the problem
    expect(rows[0]!.credentialLapsed).toEqual([lapsing]); // the row names who
  });

  it("does NOT board a healthy fully-Crewed shift", async () => {
    const solid = await addCrew("solid");
    await addShift("c2", hoursAfterT0(24), [
      { state: "Confirmed", assigned: solid },
    ]);

    expect(await deriveAtRiskBoard(repo, T0)).toEqual([]);
  });

  it("ignores Cancelled and Completed shifts entirely", async () => {
    await addCrew("ghost2");
    await addShift("x1", hoursAfterT0(24), [{ state: "Bailed" }], "Cancelled");
    await addShift("x2", hoursAfterT0(24), [{ state: "Bailed" }], "Completed");

    expect(await deriveAtRiskBoard(repo, T0)).toEqual([]);
  });
});

describe("fills-by deadline + multi-trip times (DEC-031, #59)", () => {
  it("binds the displayed deadline to the boarding instant: fillsBy === tripStart − EXHAUSTED_THRESHOLD_HOURS", async () => {
    // One constant (DEC-031): the rendered 'fills by' IS the instant the
    // willingness-exhaustion route boards on — the two cannot drift.
    expect(EXHAUSTED_THRESHOLD_HOURS).toBe(FILL_DEADLINE_HOURS);
    await addCrew("ann");
    const { shiftId, seatIds } = await addShift("f1", hoursAfterT0(24), [{}]);
    await broadcastAllDecline(seatIds[0]!);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    const row = rows[0]!;
    expect(row.fillsBy!.getTime()).toBe(
      row.tripStart!.getTime() - FILL_DEADLINE_HOURS * 3600_000,
    );
  });

  it("renders an honest past deadline — a willingness-exhausted row boards only AFTER fills-by", async () => {
    // Trip 24h out, deadline 48h before → 24h in the past at T0. Not clamped.
    await addCrew("ann");
    const { seatIds } = await addShift("f2", hoursAfterT0(24), [{}]);
    await broadcastAllDecline(seatIds[0]!);

    const row = (await deriveAtRiskBoard(repo, T0))[0]!;
    expect(row.fillsBy!.getTime()).toBeLessThan(T0.getTime());
  });

  it("carries every scheduled departure in tripStarts, earliest first (multi-trip day)", async () => {
    // A two-trip day: one shift, two scheduled events. tripStart is just the
    // earliest; tripStarts carries both so the board can show both times.
    const shiftId = asId<"ShiftId">("mt1");
    const vesselId = asId<"VesselId">("vessel-mt1");
    const t1 = hoursAfterT0(24); // 15:30-ish, earlier
    const t2 = hoursAfterT0(28); // later same window
    const date = t1.toISOString().slice(0, 10);
    for (const [i, t] of [t2, t1].entries()) {
      // saved later-first to prove sorting, not insertion order
      await repo.saveEvent({
        id: asId<"EventId">(`event-mt1-${i}`),
        vesselId,
        date: t.toISOString().slice(0, 10),
        time: t.toISOString().slice(11, 16),
        capacity: 6,
        source: "xola", status: "scheduled",
      });
    }
    await repo.saveShift({
      id: shiftId,
      vesselId,
      date,
      state: "Filling",
      eventIds: [asId<"EventId">("event-mt1-0"), asId<"EventId">("event-mt1-1")],
    });
    const seatId = asId<"SeatId">("seat-mt1-1");
    await repo.saveSeat({
      id: seatId,
      shiftId,
      role: CAPTAIN,
      kind: "required",
      state: "Open",
    });
    await addCrew("ann");
    await broadcastAllDecline(seatId);

    const row = (await deriveAtRiskBoard(repo, T0, { tz: "UTC" }))[0]!;
    expect(row.tripStarts.map((d) => d.getTime())).toEqual([
      t1.getTime(),
      t2.getTime(),
    ]);
    expect(row.tripStart!.getTime()).toBe(t1.getTime()); // earliest === [0]
    // Deadline anchors to the earliest departure.
    expect(row.fillsBy!.getTime()).toBe(t1.getTime() - FILL_DEADLINE_HOURS * 3600_000);
  });
});

describe("urgency ordering (ordinal — SPEC §2.5 acceptance criteria)", () => {
  it("sooner trip beats later trip", async () => {
    const a = await addShift("soon", hoursAfterT0(12), [{}]);
    const b = await addShift("later", hoursAfterT0(40), [{}]);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([a.shiftId, b.shiftId]);
  });

  it("regression beats a never-filled shift at similar time-to-trip", async () => {
    await addCrew("ghost3");
    const bailed = await addShift("bailed", hoursAfterT0(28), [
      { state: "Bailed" },
    ]);
    // Never-filled core row slightly SOONER — regression must still outrank.
    await addCrew("ann");
    const never = await addShift("never", hoursAfterT0(24), [{}]);
    await broadcastAllDecline(never.seatIds[0]!);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([bailed.shiftId, never.shiftId]);
  });

  it("a regression days out does NOT bury a trip leaving in hours", async () => {
    await addCrew("ghost4");
    const bailedFar = await addShift("bailedfar", hoursAfterT0(6 * 24), [
      { state: "Bailed" },
    ]);
    await addCrew("ann2");
    const leavingNow = await addShift("leavingnow", hoursAfterT0(3), [{}]);
    await broadcastAllDecline(leavingNow.seatIds[0]!);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([
      leavingNow.shiftId,
      bailedFar.shiftId,
    ]);
  });

  it("thinner pool beats deeper pool at the same time-to-trip — DEC-025: thinness, not role names", async () => {
    // The THIN pool is the MATE seat (1 candidate) and the deep one the CAPTAIN
    // seat (3 candidates): if urgency branched on the role name instead of the
    // pool, this ordering would flip.
    await addCrew("solo-mate", { ratings: [MATE] });
    const thin = await addShift("thinmate", hoursAfterT0(24), [{ role: MATE }]);
    await broadcastAllDecline(thin.seatIds[0]!);

    await addCrew("cap1");
    await addCrew("cap2");
    await addCrew("cap3");
    const deep = await addShift("deepcap", hoursAfterT0(24), [{ role: CAPTAIN }]);
    await broadcastAllDecline(deep.seatIds[0]!);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([thin.shiftId, deep.shiftId]);
  });
});

describe("the available list (the lean's targets)", () => {
  it("lists the gap seats' eligible pool, minus anyone committed on the shift", async () => {
    const held = await addCrew("held");
    await addCrew("free1");
    await addCrew("free2");
    // Two captain seats: `held` confirmed on the first, second still open and
    // ghosted — `held` must not be offered for the seat next to their own.
    const { shiftId, seatIds } = await addShift("a1", hoursAfterT0(24), [
      { state: "Confirmed", assigned: held },
      {},
    ]);
    await broadcastAllDecline(seatIds[1]!);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    const available = rows[0]!.available;
    expect(available).toHaveLength(2);
    expect(available).not.toContain(held);
    expect(rows[0]!.gaps).toEqual([{ role: CAPTAIN, missing: 1 }]);
  });

  it("excludes a live-ask holder — they're already deciding, lean would refuse", async () => {
    await addCrew("midflight");
    const { shiftId, seatIds } = await addShift("a3", hoursAfterT0(24), [
      { state: "Bailed" }, // the row's reason (regression)
      {}, // a second open seat the broadcast goes out on
    ]);
    await broadcastAsk(repo, seatIds[1]!, T0); // midflight now has a live ask
    const late = await addCrew("late-joiner"); // eligible, never asked

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.available).toEqual([late]);
  });

  it("excludes whoever bailed on this shift — matching the re-ask's own exclusion", async () => {
    const bailer = await addCrew("bailer");
    const sub = await addCrew("sub");
    const { shiftId, seatIds } = await addShift("a2", hoursAfterT0(24), [
      { state: "Bailed" },
    ]);
    await logShiftBailed(repo, bailer, shiftId, T0, 1000, seatIds[0]!);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.available).toEqual([sub]);
  });
});

describe("crew bail → board regression, end-to-end (#56, DEC-028)", () => {
  it("a 'can't make it' through the real rails still boards the shift (as uncrewed) with honest lateness", async () => {
    const ann = await addCrew("ann"); // the only captain
    const tripAt = hoursAfterT0(36);
    const { shiftId, seatIds } = await addShift("e2e", tripAt, [{}]);

    // The full loop the crew action drives: ask → accept → confirm → bail.
    const [ask] = await broadcastAsk(repo, seatIds[0]!, T0);
    await recordResponse(repo, ask!.id, "accepted", T0);
    await confirmSeat(repo, seatIds[0]!, T0);
    const noticeMs = tripAt.getTime() - T0.getTime();
    await bail(repo, seatIds[0]!, T0, bailLatenessMs(tripAt, T0), noticeMs);

    // Board: the bail now rests the seat Open (DEC-128 #483 — `Bailed` retired),
    // so the near-trip uncrewed shift boards via the fill-deadline route as `core`,
    // NOT as a `regression` (that tag required a resting-Bailed seat; the re-ping is
    // an accepted loss). The operator still sees the shift needs crew.
    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.reasons).toContain("core");
    expect(rows[0]!.reasons).not.toContain("regression");

    // Log: the bail is still recorded with honest lateness — derived lead shortfall
    // (7d − 36h), raw notice alongside. DEC-028 unchanged.
    const event = (await repo.reliabilityEventsFor(ann)).find(
      (e) => e.type === "shift_bailed",
    )!;
    expect(event.metadata.latenessMs).toBe((7 * 24 - 36) * 3600_000);
    expect(event.metadata.noticeMs).toBe(36 * 3600_000);
  });
});

// #316 — the board re-read the SAME crew's reliability/credentials/PTO once per
// shift (directly + through escalationTrailFor/solveShift/rankedEligible), an
// `N shifts × M crew` round-trip explosion. The render-scoped cache collapses it:
// each per-crew key is read at most once, regardless of how many shifts board.
describe("query batching (#316)", () => {
  const noRepeatedKeys = (calls: unknown[][]) => {
    const keys = calls.map((c) => String(c[0]));
    expect(new Set(keys).size).toBe(keys.length); // each id fetched at most once
  };

  it("reads each crew's reliability/credentials/PTO at most once across many shifts", async () => {
    for (const id of ["ann", "bob", "cy", "dot"]) await addCrew(id);
    // Three at-risk shifts (a resting Bailed required seat → regression). Each
    // exercises the full read path (trail + solve + rankedEligible over the pool).
    for (let i = 0; i < 3; i++) {
      await addShift(`br-${i}`, hoursAfterT0(24), [{ state: "Bailed" }]);
    }

    const relSpy = vi.spyOn(repo, "reliabilityEventsFor");
    const credSpy = vi.spyOn(repo, "listCredentialsForCrew");
    const ptoSpy = vi.spyOn(repo, "listPtoWindowsForCrew");

    const board = await deriveAtRiskBoard(repo, T0);

    expect(board).toHaveLength(3); // all three boarded — behavior preserved
    // The fix: no key re-fetched. Pre-cache this was 3× these counts.
    noRepeatedKeys(relSpy.mock.calls);
    noRepeatedKeys(credSpy.mock.calls);
    noRepeatedKeys(ptoSpy.mock.calls);

    relSpy.mockRestore();
    credSpy.mockRestore();
    ptoSpy.mockRestore();
  });
});
