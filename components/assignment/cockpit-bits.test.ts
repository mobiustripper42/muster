/**
 * `toSeatVM`'s action mapping (#601). The file's stated rule is **never render a
 * button the action refuses** — and that rule spans three places: this mapper, the
 * `lean()` behind "Nudge", and `assignFromPool()` behind "Ask to fill". Those two
 * server actions accept DIFFERENT seat states, so one shared `canAct` boolean cannot
 * gate both. It shipped that way once; this pins it.
 */
import { describe, expect, it } from "vitest";
import type { SeatCardView } from "@core/asks/assignment-view.js";
import { toSeatVM } from "./cockpit-bits.js";

function seatCard(state: string, poolStatuses: string[]): SeatCardView {
  return {
    seatId: "seat-1",
    role: "role-captain",
    roleName: "captain",
    state,
    pool: poolStatuses.map((status, i) => ({
      crewMemberId: `crew-${i}`,
      name: `crew ${i}`,
      status,
    })),
  } as unknown as SeatCardView;
}

const actionsFor = (state: string, statuses: string[]) =>
  toSeatVM(seatCard(state, statuses), "shift-1", null, new Map(), new Map())
    .pool!.map((c) => c.action);

describe("toSeatVM — the rendered action must match what the server action accepts", () => {
  it("Open seat: available → assign, silent/declined → nudge", () => {
    expect(actionsFor("Open", ["available", "silent", "declined"])).toEqual([
      "assign",
      "nudge",
      "nudge",
    ]);
  });

  it("Bailed seat behaves like Open", () => {
    expect(actionsFor("Bailed", ["available", "silent"])).toEqual(["assign", "nudge"]);
  });

  it("Asked seat NEVER offers assign — assignFromPool refuses a non-gap seat (#601)", () => {
    // The bug this pins: widening `canAct` to include `Asked` also switched on the
    // "Ask to fill" button, but `assignFromPool` still gates Open/Bailed only
    // (`lean.ts:204`), so clicking it returns `no_gap` → "That seat isn't open to
    // assign into." `lean()` DOES accept an Asked seat, so nudge is correct here.
    expect(actionsFor("Asked", ["available", "silent", "declined"])).toEqual([
      "nudge",
      "nudge",
      "nudge",
    ]);
  });

  it("settled seats offer nothing — somebody holds them", () => {
    expect(actionsFor("Confirmed", ["available", "silent"])).toEqual([null, null]);
    expect(actionsFor("Claimed", ["available", "silent"])).toEqual([null, null]);
  });

  it("a bailed candidate is never actionable, whatever the seat", () => {
    expect(actionsFor("Open", ["bailed"])).toEqual([null]);
    expect(actionsFor("Asked", ["bailed"])).toEqual([null]);
  });
});
