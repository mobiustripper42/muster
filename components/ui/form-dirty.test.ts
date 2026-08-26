import { describe, expect, it } from "vitest";
import { canonicalFormState } from "./form-dirty";

/**
 * "Dirty" is a comparison against the values the form was born with (#781).
 *
 * The alternative — a flag set by the first `input` event — is what
 * `components/admin/dirty-submit.tsx` does today, and it cannot answer the case in
 * `typing and undoing it` below. Issue #781 names that as the decision that has to be
 * settled before the island is written, because it is what decides how annoying the
 * feature is, and an over-eager guard gets muted by the person it is protecting.
 *
 * The comparison is over `[name, value]` pairs rather than an `HTMLFormElement` on
 * purpose: Vitest runs `environment: "node"` here (`vitest.config.ts`) with no jsdom,
 * so a DOM-shaped signature would be untestable without a new dependency. The island
 * passes `new FormData(form)`, which yields exactly these pairs — the same shape
 * `app/lib/form-draft.ts:82` already reduces a submission to.
 */
describe("canonicalFormState", () => {
  it("is stable for the same values", () => {
    const pairs: [string, string][] = [
      ["label", "Sunset Charcuterie"],
      ["amount", "45.00"],
    ];
    expect(canonicalFormState(pairs)).toBe(canonicalFormState([...pairs]));
  });

  it("changes when a value changes", () => {
    expect(canonicalFormState([["amount", "45.00"]])).not.toBe(
      canonicalFormState([["amount", "46.00"]]),
    );
  });

  it("is unchanged by typing and undoing it — the case that rules out input-event tracking", () => {
    // Born empty, typed into, put back. The form holds nothing new, so nothing should warn.
    const born: [string, string][] = [["label", ""]];
    const afterTypingAndDeleting: [string, string][] = [["label", ""]];
    expect(canonicalFormState(afterTypingAndDeleting)).toBe(canonicalFormState(born));
  });

  it("changes when a checkbox is ticked", () => {
    // An unticked checkbox posts nothing at all, so ticking one ADDS an entry rather than
    // changing one — the shape a naive per-field diff misses.
    expect(canonicalFormState([["label", "x"]])).not.toBe(
      canonicalFormState([
        ["label", "x"],
        ["required", "on"],
      ]),
    );
  });

  it("ignores the order two boxes in one group were ticked in", () => {
    // `vesselIds`, `weekday`, `addOnIds` are multi-value groups. Ticking A then B is the same
    // state as ticking B then A, and a guard that disagrees warns about a form nobody changed.
    expect(
      canonicalFormState([
        ["vesselIds", "hops"],
        ["vesselIds", "barley"],
      ]),
    ).toBe(
      canonicalFormState([
        ["vesselIds", "barley"],
        ["vesselIds", "hops"],
      ]),
    );
  });

  it("counts a repeated value rather than collapsing it", () => {
    expect(canonicalFormState([["day", "1"]])).not.toBe(
      canonicalFormState([
        ["day", "1"],
        ["day", "1"],
      ]),
    );
  });

  it("cannot be fooled by a value that looks like a field boundary", () => {
    // The trap in every delimiter-joined implementation: `a` + `bc` and `ab` + `c` collide the
    // moment the parts are concatenated. Two different forms must never share a state string.
    expect(canonicalFormState([["ab", "c"]])).not.toBe(canonicalFormState([["a", "bc"]]));
  });

  it("distinguishes an empty form from one absent field", () => {
    expect(canonicalFormState([])).not.toBe(canonicalFormState([["label", ""]]));
  });
});
