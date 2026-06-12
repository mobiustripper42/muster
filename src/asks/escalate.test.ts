/**
 * Tier-2 escalation mechanism (DEC-024, §1.2). `escalate` is the writer for the
 * 3.2a substrate: widen-stub + direct-nudge the Tier-1 ghosters. Preconditions
 * (a `Filling` shift with `Open` stalled seats + silent/declined asks) are seeded
 * directly so each candidate-filter rule is exercised in isolation.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId } from "../domain/ids.js";
import type {
  Ask,
  Credential,
  CrewMember,
  Seat,
  Shift,
} from "../domain/entities.js";
import { escalate } from "./escalate.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const VESSEL = asId<"VesselId">("vessel-x");
const SHIFT = asId<"ShiftId">("shift-1");
const DATE = "2026-07-01";
const T0 = new Date("2026-07-01T12:00:00.000Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

async function addCrew(id: string, over: Partial<CrewMember> = {}): Promise<CrewMemberId> {
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
  await repo.saveCredential({
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: crewId,
    type: "MMC",
    expiry: "2026-12-31",
  } satisfies Credential);
  return crewId;
}

/** A `Filling` shift with `seatCount` open required seats. */
async function fillingShift(seatCount: number): Promise<SeatId[]> {
  await repo.saveShift({
    id: SHIFT,
    vesselId: VESSEL,
    date: DATE,
    state: "Filling",
    eventIds: [],
  } satisfies Shift);
  const ids: SeatId[] = [];
  for (let i = 1; i <= seatCount; i++) {
    const seatId = asId<"SeatId">(`seat-${i}`);
    await repo.saveSeat({
      id: seatId,
      shiftId: SHIFT,
      role: CAPTAIN,
      kind: "required",
      state: "Open",
    } satisfies Seat);
    ids.push(seatId);
  }
  return ids;
}

/** Seed a settled ask on a seat: silent (timed out) or declined. */
async function seedAsk(
  seatId: SeatId,
  crewId: CrewMemberId,
  kind: "silent" | "declined",
): Promise<void> {
  const ask: Ask = {
    id: asId<"AskId">(`ask-${seatId}-${crewId}`),
    seatId,
    crewMemberId: crewId,
    channel: "push",
    sentAt: T0.toISOString(),
    respondedAt: later(60_000).toISOString(),
    ...(kind === "declined" ? { response: "declined" as const } : {}),
  };
  await repo.saveAsk(ask);
}

const seatState = (id: SeatId) => repo.getSeat(id).then((s) => s!.state);
const nudgedEvents = (crewId: CrewMemberId) =>
  repo.reliabilityEventsFor(crewId).then((es) => es.filter((e) => e.type === "nudged"));

describe("escalate — nudging the ghosters", () => {
  it("nudges the top-ranked silent crew and skips the decliner", async () => {
    const silent = await addCrew("crew-silent");
    const decliner = await addCrew("crew-decliner");
    const [seat] = await fillingShift(1);
    await seedAsk(seat!, silent, "silent");
    await seedAsk(seat!, decliner, "declined");

    const out = await escalate(repo, SHIFT, later(120_000));

    expect(out.widened).toBe(true);
    expect(out.nudged).toEqual([silent]); // decliner excluded
    // The nudge ask is surfaced for the edge's channel forwarding (DEC-030).
    expect(out.asks).toHaveLength(1);
    expect(out.asks[0]!.crewMemberId).toBe(silent);
    expect(out.asks[0]!.seatId).toBe(seat);
    expect(await seatState(seat!)).toBe("Asked"); // assignPerson moved it
    expect(await nudgedEvents(silent)).toHaveLength(1);
    expect(await nudgedEvents(decliner)).toHaveLength(0);
  });

  it("logs the widen-stub even when no one is nudgeable", async () => {
    const decliner = await addCrew("crew-decliner");
    const [seat] = await fillingShift(1);
    await seedAsk(seat!, decliner, "declined");

    const out = await escalate(repo, SHIFT, later(120_000));

    expect(out.widened).toBe(true);
    expect(out.nudged).toEqual([]);
    // pool_widened is the system-keyed trail rung (DEC-024).
    const sys = await repo.reliabilityEventsFor(asId<"CrewMemberId">("system"));
    expect(sys.filter((e) => e.type === "pool_widened")).toHaveLength(1);
    expect(await seatState(seat!)).toBe("Open"); // nobody nudged, seat untouched
  });

  it("never re-nudges the same person — escalation terminates", async () => {
    const silent = await addCrew("crew-silent");
    const [seat] = await fillingShift(1);
    await seedAsk(seat!, silent, "silent");

    const first = await escalate(repo, SHIFT, later(120_000));
    expect(first.nudged).toEqual([silent]);

    // Their nudge times out too → seat reopens Open, but they're already-nudged.
    await repo.saveSeat({ ...(await repo.getSeat(seat!))!, state: "Open" });
    const second = await escalate(repo, SHIFT, later(240_000));

    expect(second.widened).toBe(true);
    expect(second.nudged).toEqual([]); // not re-poked
    expect(await nudgedEvents(silent)).toHaveLength(1); // still just the one
  });

  it("excludes crew already committed to a sibling seat (distinct-pool, DEC-003)", async () => {
    const a = await addCrew("crew-a");
    const b = await addCrew("crew-b");
    const [s1, s2] = await fillingShift(2);
    // s1 confirmed by a; s2 open. a is eligible for s2 but committed → excluded.
    await repo.saveSeat({
      ...(await repo.getSeat(s1!))!,
      state: "Confirmed",
      assignedCrewMemberId: a,
    });
    await seedAsk(s2!, a, "silent");
    await seedAsk(s2!, b, "silent");

    const out = await escalate(repo, SHIFT, later(120_000));

    expect(out.nudged).toEqual([b]); // a is committed elsewhere on the shift
  });

  it("nudges one person at most once across two open seats (threaded used-set)", async () => {
    const only = await addCrew("crew-only");
    const [s1, s2] = await fillingShift(2);
    await seedAsk(s1!, only, "silent");
    await seedAsk(s2!, only, "silent");

    const out = await escalate(repo, SHIFT, later(120_000));

    expect(out.nudged).toEqual([only]); // not [only, only]
    // Exactly one seat got the nudge; the other stays Open.
    const states = [await seatState(s1!), await seatState(s2!)].sort();
    expect(states).toEqual(["Asked", "Open"]);
  });

  it("is a no-op on a shift that isn't Filling", async () => {
    const silent = await addCrew("crew-silent");
    const [seat] = await fillingShift(1);
    await seedAsk(seat!, silent, "silent");
    await repo.saveShift({ ...(await repo.getShift(SHIFT))!, state: "AtRisk" });

    const out = await escalate(repo, SHIFT, later(120_000));

    expect(out).toEqual({ widened: false, nudged: [], asks: [] });
    expect(await nudgedEvents(silent)).toHaveLength(0);
  });
});
