/**
 * The booker's party page (Phase 18.6, issue #1120) — what `/b/<code>/party` shows. Spec:
 * `docs/design/check-in-surfaces.md` §B.
 *
 * Clock: Saturday 2026-10-10, boat time.
 */
import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { Guest } from "./entities.js";
import { buildPartyView } from "./party.js";

const TODAY = "2026-10-10";
const EVENT = asId<"EventId">("evt-3pm");
const SMITHS = asId<"ReservationId">("res-smith");

function guest(id: string, name: string, over: Partial<Guest> = {}): Guest {
  return {
    id: asId<"GuestId">(id),
    eventId: EVENT,
    reservationId: SMITHS,
    name,
    email: `${id}@example.com`,
    dob: "1980-04-02",
    isMinor: false,
    signedAt: "2026-10-01T18:00:00.000Z",
    source: "self",
    createdAt: "2026-10-01T18:00:00.000Z",
    ...over,
  };
}

const robert = guest("g-robert", "Robert Smith");
const kyle = guest("g-kyle", "Kyle Smith", { dob: "2014-06-20", isMinor: true, guardianGuestId: robert.id });

describe("buildPartyView — the booker's page", () => {
  it("every signed name, alphabetical ignoring case, none folded", () => {
    const names = Array.from({ length: 14 }, (_, i) => guest(`g${i}`, `Guest ${String.fromCharCode(90 - i)}`));
    const v = buildPartyView([...names, guest("g-amy", "amy Nowak")], 16, 16, TODAY);
    expect(v.names).toHaveLength(15);
    expect(v.names[0]?.name).toBe("amy Nowak");
    expect(v.names.at(-1)?.name).toBe("Guest Z");
  });

  it("a minor shows their age today; an adult shows none", () => {
    const v = buildPartyView([robert, kyle], 4, 16, TODAY);
    expect(v.names).toEqual([
      { name: "Kyle Smith", age: 12, times: 1 },
      { name: "Robert Smith", times: 1 },
    ]);
  });

  it("a minor's age is dropped once retention has cleared the date of birth", () => {
    const { dob: _gone, ...noDob } = kyle;
    expect(buildPartyView([noDob], 4, 16, TODAY).names[0]).toEqual({ name: "Kyle Smith", times: 1 });
  });

  it("an obvious duplicate shows once, ×2, and counts once", () => {
    const v = buildPartyView([guest("f1", "Fred Kowalski"), guest("f2", "Fred Kowalski"), robert], 16, 16, TODAY);
    expect(v.names).toEqual([
      { name: "Fred Kowalski", times: 2 },
      { name: "Robert Smith", times: 1 },
    ]);
    expect(v.coverage).toEqual({ covered: 2, of: 16, remaining: 14 });
  });

  it("the count stops at the party size, and both numbers at the boat's limit", () => {
    const five = ["A", "B", "C", "D", "E"].map((n) => guest(`g-${n}`, n));
    expect(buildPartyView(five, 4, 16, TODAY).coverage).toEqual({ covered: 4, of: 4, remaining: 0 });
    expect(buildPartyView(five, 20, 3, TODAY).coverage).toEqual({ covered: 3, of: 3, remaining: 0 });
    // Every name is still listed — the COI rule caps numbers, not names.
    expect(buildPartyView(five, 20, 3, TODAY).names).toHaveLength(5);
  });

  it("nobody signed yet is 0 of the party", () => {
    expect(buildPartyView([], 6, 16, TODAY)).toEqual({ names: [], coverage: { covered: 0, of: 6, remaining: 6 } });
  });
});
