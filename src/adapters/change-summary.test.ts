/**
 * What "your shift changed" actually says (#740).
 *
 * The old notice was `your Fri Aug 14 - Brew 3 shift changed - check the app.` — it named the
 * shift and said something moved, never what. A call time sliding 90 minutes earlier and a fourth
 * trip appearing produced byte-identical text. The diff that proved a change existed was computed
 * in `formShifts` and dropped on the floor.
 *
 * The hard constraint is the segment. The body is GSM-7 and one segment on purpose, and #619 has
 * already been bitten by a single character silently doubling the count — so this is not a place
 * for prose, it is a place for the shortest true tokens, with a defined answer for what happens
 * when they do not fit.
 */
import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import { changeSummary, GSM7_SEGMENT } from "./change-summary.js";

const ev = (s: string) => asId<"EventId">(s);

/** 15:30 and 14:00 vessel-local (America/New_York, EDT) on 2026-05-16. */
const AT_1530 = "2026-05-16T19:30:00.000Z";
const AT_1400 = "2026-05-16T18:00:00.000Z";

describe("changeSummary (#740)", () => {
  it("names the call time move, in crew-facing terms", () => {
    // The crew member does not care when the boat leaves so much as when THEY have to be
    // there — call time is departure minus the 45-minute lead (CALL_LEAD_MINUTES). 15:30
    // departure = 2:45 PM call; 14:00 departure = 1:15 PM call.
    const s = changeSummary(
      { added: [], removed: [], startBefore: AT_1530, startAfter: AT_1400 },
      { budget: 200 },
    );
    expect(s).toBe("call 2:45->1:15");
  });

  it("counts trips added and removed, and does not distinguish them by phrasing", () => {
    // Operator's call, 2026-08-17: "+1 trip" and "-1 trip" read the same. No separate
    // wording for a day that grew versus one that shrank.
    expect(
      changeSummary(
        { added: [ev("a")], removed: [], startBefore: AT_1530, startAfter: AT_1530 },
        { budget: 200 },
      ),
    ).toBe("+1 trip");
    expect(
      changeSummary(
        { added: [], removed: [ev("b")], startBefore: AT_1530, startAfter: AT_1530 },
        { budget: 200 },
      ),
    ).toBe("-1 trip");
    expect(
      changeSummary(
        { added: [ev("a"), ev("b")], removed: [], startBefore: AT_1530, startAfter: AT_1530 },
        { budget: 200 },
      ),
    ).toBe("+2 trips");
  });

  it("puts the call time first when both moved", () => {
    // Ordered by what the crew member acts on. A call time move changes when they leave the
    // house; a trip added mostly does not. If only one token fits, it must be this one.
    const s = changeSummary(
      { added: [ev("a")], removed: [], startBefore: AT_1530, startAfter: AT_1400 },
      { budget: 200 },
    );
    expect(s).toBe("call 2:45->1:15, +1 trip");
  });

  it("never claims a call-time change that did not happen", () => {
    // The trap: a trip cancelled off the END of a day leaves the earliest departure alone.
    // Reporting "call 2:45->2:45" would be noise; inventing a move would be a lie that sends
    // someone to the dock at the wrong time.
    const s = changeSummary(
      { added: [], removed: [ev("b")], startBefore: AT_1530, startAfter: AT_1530 },
      { budget: 200 },
    );
    expect(s).toBe("-1 trip");
    expect(s).not.toContain("call");
  });

  it("drops whole tokens to fit the budget, never truncates one", () => {
    // A truncated token is worse than an absent one: "call 2:45->1:" is unreadable, and
    // "+1 tri" looks like a bug to the person holding the phone.
    const full = { added: [ev("a")], removed: [], startBefore: AT_1530, startAfter: AT_1400 };
    expect(changeSummary(full, { budget: 200 })).toBe("call 2:45->1:15, +1 trip");
    // Room for the first token only.
    expect(changeSummary(full, { budget: 16 })).toBe("call 2:45->1:15");
    // Room for neither.
    expect(changeSummary(full, { budget: 5 })).toBeNull();
  });

  it("returns null when there is nothing true to say", () => {
    // Then the caller falls back to today's text. The app still carries the full detail, so
    // the fallback loses nothing — it is a shorter pointer, not a worse claim.
    expect(
      changeSummary(
        { added: [], removed: [], startBefore: AT_1530, startAfter: AT_1530 },
        { budget: 200 },
      ),
    ).toBeNull();
  });

  it("says nothing about the clock when a start is unknown", () => {
    // `startBefore` is absent on a shift row written before the watermark column existed.
    // Unknown is not "moved" — a notice claiming a time change it cannot substantiate is
    // exactly the false alarm the nullable column was designed to prevent.
    const s = changeSummary(
      { added: [ev("a")], removed: [], startBefore: null, startAfter: AT_1400 },
      { budget: 200 },
    );
    expect(s).toBe("+1 trip");
  });

  it("is GSM-7 only — no character that would flip the body to UCS-2", () => {
    // One non-GSM character doubles the segment count silently (#619). The arrow is ASCII
    // `->`, not the typographic one, and this asserts it across every shape.
    const shapes = [
      { added: [ev("a")], removed: [], startBefore: AT_1530, startAfter: AT_1400 },
      { added: [], removed: [ev("b")], startBefore: AT_1530, startAfter: AT_1530 },
      { added: [ev("a"), ev("b")], removed: [ev("c")], startBefore: AT_1530, startAfter: AT_1400 },
    ];
    for (const shape of shapes) {
      const s = changeSummary(shape, { budget: GSM7_SEGMENT })!;
      expect(s).not.toMatch(/[→–—’‘“”…]/);
      expect(s).toMatch(/^[ -~]*$/); // printable ASCII, a strict subset of GSM-7
    }
  });
});
