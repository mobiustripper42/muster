/**
 * `errCopyFor` — the one place a redirect error code widens from a typed union back to a string
 * (#654), and therefore the one place that has to be bulletproof.
 *
 * **The prototype fallthrough.** The first cut looked the code up with plain property access:
 *
 *     const hit = table[raw];
 *     if (hit !== undefined) return hit;
 *
 * Every JS object inherits `constructor`, `toString`, `hasOwnProperty`, `valueOf` and friends from
 * `Object.prototype`, so `?err=constructor` returned the `Object` **function** — not `undefined` —
 * the guard read it as a real hit, and the caller rendered it straight into JSX. React throws
 * "Objects are not valid as a React child" on a function, so any signed-in user following
 * `/admin/add-ons?sel=x&err=constructor` crashed the page render. Ten surfaces, all reachable by
 * URL.
 *
 * That is precisely the defect class #654 set out to remove — "a lookup that cannot fail is a
 * lookup that cannot tell you it was wrong" — reopened inside the helper written to prevent it.
 * Found by `@code-review` auditing the merged PR, not by the type system: TypeScript cannot help,
 * because at this boundary `raw` is legitimately an arbitrary string off the URL.
 */
import { describe, expect, it } from "vitest";
import { errCopyFor } from "./err-copy";

const TABLE = {
  name_required: "Give the location a name.",
  error: "Couldn’t save that just now — try again in a moment.",
} as const;

describe("errCopyFor", () => {
  it("returns the mapped copy for a real code", () => {
    expect(errCopyFor(TABLE, "name_required", "error")).toBe(TABLE.name_required);
  });

  it("returns null for no code at all", () => {
    expect(errCopyFor(TABLE, undefined, "error")).toBeNull();
  });

  it("falls back for an unmapped code", () => {
    expect(errCopyFor(TABLE, "not_a_real_code", "error")).toBe(TABLE.error);
  });

  it("falls back with no fallback given → null", () => {
    expect(errCopyFor(TABLE, "not_a_real_code")).toBeNull();
  });

  /**
   * The regression. Each of these is an inherited `Object.prototype` member, so plain property
   * access returns a truthy non-string and the `!== undefined` guard waves it through.
   *
   * The assertion is deliberately `toBe(TABLE.error)` rather than "not a function": the caller
   * renders this value, so the only safe outcome is the fallback COPY. Anything else — a function,
   * an object, a bare `undefined` slipping past — is a crash or a blank notice.
   */
  it("does not fall through to Object.prototype for an inherited key", () => {
    for (const evil of [
      "constructor",
      "toString",
      "hasOwnProperty",
      "valueOf",
      "isPrototypeOf",
      "propertyIsEnumerable",
      "toLocaleString",
      "__defineGetter__",
    ]) {
      expect(errCopyFor(TABLE, evil, "error"), `?err=${evil}`).toBe(TABLE.error);
    }
  });

  it("does not fall through for __proto__ either", () => {
    // `__proto__` is an accessor on Object.prototype, so it returns the prototype OBJECT rather
    // than a function — same crash, different shape.
    expect(errCopyFor(TABLE, "__proto__", "error")).toBe(TABLE.error);
  });

  it("returns null for an inherited key when there is no fallback", () => {
    // `/admin/import` uses the no-fallback form. It must render nothing, not a native function.
    expect(errCopyFor(TABLE, "constructor")).toBeNull();
  });
});
