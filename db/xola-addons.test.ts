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

  it("keeps flagging a DECLARED-but-unpaid answer when nothing else was selected", () => {
    // Sarah McCarty, 2026-08-22 15:30, Brew 1 — declared 4, paid 0, on a 14-pax boat (16 > 14).
    // Her declaration is unpaid, so its row carries quantity 0, and there is no competing
    // selected answer to override it. Operator, 2026-08-18: this is a legitimate error and must
    // stay on the list — "didn't pay" is not "didn't say", and the DECLARED ≠ PAID section
    // exists for exactly this.
    //
    // The first version of this guard skipped every quantity-0 row and silenced her. That is the
    // dangerous direction on a Certificate-of-Inspection limit, and it shipped because THIS
    // fixture was invented rather than read off `--raw`.
    const r = readAddOns({ addOns: [q(`${GUESTS}: Yes-four more`, 0)] });
    expect(r.declaredMax).toBe(4);
    expect(r.declared).toEqual(["Yes-four more"]);
  });

  it("prefers the selected answers when there are any, and takes the worst of them", () => {
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
