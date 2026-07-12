/**
 * `db:own` CLI logic (DEC-106) — framework-free, driven against the in-memory repo.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { Event } from "../domain/entities.js";
import { OwnCliError, runOwnCommand } from "./own-cli.js";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const VESSEL = "vessel-brew-2";

const xolaEvent = (over: Partial<Event> = {}): Event => ({
  id: asId<"EventId">("evt-1"),
  vesselId: asId<"VesselId">(VESSEL),
  date: "2026-07-04",
  time: "15:00",
  capacity: 12,
  status: "scheduled",
  source: "xola",
  ...over,
});

describe("db:own CLI", () => {
  it("list: empty, then reflects a mark", async () => {
    const repo = new InMemoryRepository();
    expect(await runOwnCommand(repo, ["list"], NOW)).toBe(
      "No Muster-owned vessel-days.",
    );
    await runOwnCommand(repo, ["mark", VESSEL, "2026-07-04"], NOW);
    expect(await runOwnCommand(repo, ["list"], NOW)).toBe(
      `2026-07-04  ${VESSEL}  (marked 2026-06-01T00:00:00.000Z)`,
    );
  });

  it("mark: persists the owned vessel-day with the injected timestamp", async () => {
    const repo = new InMemoryRepository();
    const out = await runOwnCommand(repo, ["mark", VESSEL, "2026-07-04"], NOW);
    expect(out).toContain("Marked vessel-day Muster-owned");
    expect(await repo.listMusterOwnedVesselDays()).toEqual([
      { vesselId: asId<"VesselId">(VESSEL), date: "2026-07-04", markedAt: NOW.toISOString() },
    ]);
  });

  it("mark: warns when an existing Xola event already sits on the day (DEC-106 sequencing)", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(xolaEvent());
    const out = await runOwnCommand(repo, ["mark", VESSEL, "2026-07-04"], NOW);
    expect(out).toContain("WARNING");
    expect(out).toContain("strand");
  });

  it("mark: rejects a missing arg or a non-ISO date", async () => {
    const repo = new InMemoryRepository();
    await expect(runOwnCommand(repo, ["mark", VESSEL], NOW)).rejects.toBeInstanceOf(
      OwnCliError,
    );
    await expect(
      runOwnCommand(repo, ["mark", VESSEL, "07/04/2026"], NOW),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("rejects an unknown command", async () => {
    const repo = new InMemoryRepository();
    await expect(runOwnCommand(repo, ["frobnicate"], NOW)).rejects.toBeInstanceOf(
      OwnCliError,
    );
  });
});
