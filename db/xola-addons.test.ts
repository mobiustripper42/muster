/**
 * Xola add-on parsing. Every fixture here is a real shape taken from `--raw` against the live
 * API on 2026-08-18, not an invented one — this module exists precisely because guessing at
 * this third-party shape is how the report starts lying.
 */
import { describe, it, expect } from "vitest";
import { readAddOns } from "./xola-addons.js";

const q = (name: string, quantity: number) => ({ quantity, configuration: { name } });
const GUESTS = "Are you interested in adding more guests over 12?";

describe("readAddOns — an option the customer DECLINED is not a declaration", () => {
  it("ignores the unselected option and reads the chosen one", () => {
    // Mallory Mitchell, 2026-08-22 19:30, Brew 3. She answered "No-Good with 12". Xola renders
    // EVERY option of the question as its own row and marks the chosen one with quantity >= 1,
    // so the "Yes-one more" row is present at quantity 0 — the answer she declined.
    //
    // Reading existence instead of quantity put her on the WOULD-BE-OVER list at 13 > 12, on a
    // boat she had explicitly said she was not adding to. Both of that morning's over-capacity
    // alerts were false, on the one report whose job is to say a boat is about to be overloaded.
    const r = readAddOns({
      addOns: [
        q("No", 1),
        q("I understand that if I have more than 12 people I need to call BrewBoat…: Yes-I Confirm", 1),
        q(`${GUESTS}: Yes-one more`, 0),
        q("Thank You! Greatly Appreciated!", 1),
        q("Extra Tickets: $40/person", 0),
        q(`${GUESTS}: No-Good with 12`, 1),
      ],
    });
    expect(r.declaredMax).toBe(0);
    expect(r.declared).toEqual(["No-Good with 12"]);
    expect(r.extra).toBe(0);
  });

  it("still reads a genuine YES that was actually selected", () => {
    // The guard must not swallow real declarations — that would be the dangerous over-fix,
    // silencing the alert this report exists to raise.
    const r = readAddOns({
      addOns: [q(`${GUESTS}: Yes-one more`, 1), q(`${GUESTS}: No-Good with 12`, 0)],
    });
    expect(r.declaredMax).toBe(1);
    expect(r.declared).toEqual(["Yes-one more"]);
  });

  it("keeps flagging a customer who genuinely answered more than once", () => {
    // Sarah McCarty changed her mind repeatedly, so several rows are really selected. Those are
    // a legitimate ambiguity, not noise, and `max` deliberately reports the worst case — this is
    // a Certificate-of-Inspection limit, so erring high is the safe direction (operator, 2026-08-18).
    const r = readAddOns({
      addOns: [
        q(`${GUESTS}: No-Good with 12`, 1),
        q(`${GUESTS}: Yes-four more`, 1),
        q(`${GUESTS}: Yes-two more`, 0),
      ],
    });
    expect(r.declaredMax).toBe(4);
    expect(r.declared).toEqual(["No-Good with 12", "Yes-four more"]);
  });
});

describe("readAddOns — the question's own threshold", () => {
  it("captures the number the question was calibrated to", () => {
    // "…over 12?" is asked against a 12-pax hull. The threshold is the only place the booking
    // records which size boat the customer was answering ABOUT, so it has to come back out —
    // comparing it to the boat they actually got is what catches an upgraded hull.
    expect(readAddOns({ addOns: [q(`${GUESTS}: No-Good with 12`, 1)] }).threshold).toBe(12);
    expect(
      readAddOns({ addOns: [q("Are you interested in adding more guests over 14?: No", 1)] })
        .threshold,
    ).toBe(14);
  });

  it("reads the threshold off an unselected option too — the question was still asked", () => {
    // Sarah's only quantity-1 answer is the "No"; the threshold must not depend on which option
    // she picked, because the mismatch is a property of the QUESTION, not of the answer.
    expect(readAddOns({ addOns: [q(`${GUESTS}: Yes-four more`, 0)] }).threshold).toBe(12);
  });

  it("is null when no guest question was asked at all", () => {
    expect(readAddOns({ addOns: [q("Extra Tickets: $40/person", 1)] }).threshold).toBeNull();
    expect(readAddOns({}).threshold).toBeNull();
  });
});

describe("readAddOns — the rest of the shape", () => {
  it("sums extra tickets by quantity, never by row count", () => {
    const r = readAddOns({ addOns: [q("Extra Tickets: $40/person", 3)] });
    expect(r.extra).toBe(3);
  });

  it("reports a missing addOns key rather than treating it as an empty cart", () => {
    // The wire-shape canary: every real order carries the key, so its absence means Xola moved
    // the field and every extra-guest figure in the report is unreliable.
    expect(readAddOns({}).missingAddOnsKey).toBe(true);
    expect(readAddOns({ addOns: [] }).missingAddOnsKey).toBe(false);
  });

  it("leaves an unparseable phrasing null rather than inventing a clean zero", () => {
    const r = readAddOns({ addOns: [q(`${GUESTS}: maybe, I'll call you`, 1)] });
    expect(r.declaredMax).toBeNull();
    expect(r.declared).toEqual(["maybe, I'll call you"]);
  });
});
