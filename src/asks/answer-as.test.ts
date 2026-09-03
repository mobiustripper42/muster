/**
 * The operator-as-crew identity guard (DEC-030): the outbox's inline Yes/No
 * may only answer an ask actually addressed to the operator's own crew
 * identity — never someone else's (reliability-log integrity, DEC-008).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId } from "../domain/ids.js";
import { recordResponseAs } from "./answer-as.js";
import { assignPerson } from "./ask-loop.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const SHIFT = asId<"ShiftId">("shift-1");
const SEAT = asId<"SeatId">("seat-1");
const T0 = new Date("2026-06-28T12:00:00.000Z");

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

async function addCrew(id: string): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name: id,
    phone: "555",
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
  });
  return crewId;
}

async function seedAskedSeat(to: CrewMemberId) {
  await repo.saveShift({
    id: SHIFT,
    vesselId: asId<"VesselId">("vessel-x"),
    date: "2026-07-01",
    state: "Filling",
    eventIds: [],
  });
  await repo.saveSeat({
    id: SEAT,
    shiftId: SHIFT,
    role: CAPTAIN,
    kind: "required",
    state: "Open",
  });
  return (await assignPerson(repo, SEAT, to, T0))!;
}

describe("recordResponseAs — identity-guarded inline answer", () => {
  it("rejects an ask not addressed to the answering identity — nothing written", async () => {
    const spink = await addCrew("crew-eric");
    const quint = await addCrew("crew-quint");
    const ask = await seedAskedSeat(quint); // Quint's ask, not Spink's

    const out = await recordResponseAs(repo, ask.id, spink, "accepted", T0);

    expect(out).toEqual({ code: "not_yours" });
    // The ask is untouched and no reliability event landed on either log.
    expect((await repo.getAsk(ask.id))!.respondedAt).toBeUndefined();
    const spinkEvents = await repo.reliabilityEventsFor(spink);
    expect(spinkEvents.filter((e) => e.type === "ask_accepted")).toHaveLength(0);
    const quintEvents = await repo.reliabilityEventsFor(quint);
    expect(quintEvents.filter((e) => e.type === "ask_accepted")).toHaveLength(0);
    expect((await repo.getSeat(SEAT))!.state).toBe("Asked"); // seat unchanged
  });

  it("records a matching identity's answer through the normal rails (auto-confirm + log)", async () => {
    const spink = await addCrew("crew-eric");
    const ask = await seedAskedSeat(spink);

    const out = await recordResponseAs(repo, ask.id, spink, "accepted", T0);

    expect(out.code).toBeNull();
    // A winning "in" auto-confirms (DEC-061) — the operator-as-crew path too.
    expect(out.outcome).toMatchObject({ claimed: true, seatState: "Confirmed" });
    const seat = await repo.getSeat(SEAT);
    expect(seat!.state).toBe("Confirmed");
    expect(seat!.assignedCrewMemberId).toBe(spink);
    const events = await repo.reliabilityEventsFor(spink);
    expect(events.some((e) => e.type === "ask_accepted")).toBe(true);
  });

  it("declines ride the same guard and rails", async () => {
    const spink = await addCrew("crew-eric");
    const ask = await seedAskedSeat(spink);

    const out = await recordResponseAs(repo, ask.id, spink, "declined", T0);

    expect(out.code).toBeNull();
    expect(out.outcome).toMatchObject({ claimed: false, seatState: "Open" });
  });

  it("a vanished ask reads as gone, not as someone else's", async () => {
    const spink = await addCrew("crew-eric");
    const out = await recordResponseAs(
      repo,
      asId<"AskId">("ghost"),
      spink,
      "accepted",
      T0,
    );
    expect(out).toEqual({ code: "gone" });
  });
});
