/**
 * Reliability-event logging helpers — the ask lifecycle (§1.4, DEC-008).
 * (Task 1.4a / M3.)
 */

import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId, ShiftId } from "../domain/ids.js";
import {
  logAskAccepted,
  logAskDeclined,
  logAskIgnored,
  logAskSent,
  logShiftBailed,
  logShiftCompleted,
  recordReliabilityEvent,
} from "./reliability-log.js";

const CREW = asId<"CrewMemberId">("crew-quint");
const SEAT = asId<"SeatId">("seat-1");
const SHIFT = asId<"ShiftId">("shift-1");
const NOW = new Date("2026-07-01T12:00:00.000Z");

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

describe("ask lifecycle logging", () => {
  it("logs ask_sent with seat + shift, stamped with injected now", async () => {
    const e = await logAskSent(repo, CREW, SEAT, SHIFT, NOW);
    expect(e.type).toBe("ask_sent");
    expect(e.timestamp).toBe("2026-07-01T12:00:00.000Z");
    expect(e.metadata).toEqual({ seatId: SEAT, shiftId: SHIFT });
    const log = await repo.reliabilityEventsFor(CREW);
    expect(log).toHaveLength(1);
    expect(log[0]!.id).toBe(e.id);
  });

  it("carries latency on accept and decline", async () => {
    const acc = await logAskAccepted(repo, CREW, SEAT, SHIFT, NOW, 4200);
    const dec = await logAskDeclined(repo, CREW, SEAT, SHIFT, NOW, 60000);
    expect(acc.metadata.latencyMs).toBe(4200);
    expect(dec.metadata.latencyMs).toBe(60000);
  });

  it("ask_ignored carries no latency — silence has no response time", async () => {
    const e = await logAskIgnored(repo, CREW, SEAT, SHIFT, NOW);
    expect(e.type).toBe("ask_ignored");
    expect(e.metadata.latencyMs).toBeUndefined();
  });

  it("shift_bailed carries lateness; seat is optional and omitted when absent", async () => {
    const e = await logShiftBailed(repo, CREW, SHIFT, NOW, 90 * 60 * 1000);
    expect(e.metadata.latenessMs).toBe(5_400_000);
    expect("seatId" in e.metadata).toBe(false); // exactOptionalPropertyTypes: omitted, not undefined
  });

  it("appends, never overwrites — full lifecycle accumulates in order", async () => {
    await logAskSent(repo, CREW, SEAT, SHIFT, NOW);
    await logAskAccepted(repo, CREW, SEAT, SHIFT, new Date("2026-07-01T12:00:05Z"), 5000);
    await logShiftCompleted(repo, CREW, SHIFT, new Date("2026-07-02T18:00:00Z"), SEAT);
    const log = await repo.reliabilityEventsFor(CREW);
    expect(log.map((e) => e.type)).toEqual([
      "ask_sent",
      "ask_accepted",
      "shift_completed",
    ]);
  });

  it("recordReliabilityEvent is the escape hatch for any event type", async () => {
    const e = await recordReliabilityEvent(repo, CREW, "at_risk_rescue", NOW, {
      seatId: SEAT,
      shiftId: SHIFT,
    });
    expect(e.type).toBe("at_risk_rescue");
    expect((await repo.reliabilityEventsFor(CREW))).toHaveLength(1);
  });
});
