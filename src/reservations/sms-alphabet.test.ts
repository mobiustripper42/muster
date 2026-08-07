/**
 * The guard's own tests (#685). A guard that cannot fail protects nothing, so these pin that it
 * catches the specific glyphs that have actually cost money here — and that it clears the copy
 * that replaced them.
 */
import { describe, expect, it } from "vitest";
import { nonGsm7Chars } from "./sms-alphabet.js";

describe("nonGsm7Chars", () => {
  it("catches the em dash — the character that made two bodies UCS-2", () => {
    expect(nonGsm7Chars("Thanks!\n\n— Muster")).toEqual(["—"]);
  });

  it("clears the ASCII hyphen that replaced it", () => {
    expect(nonGsm7Chars("Thanks!\n\n- Muster")).toEqual([]);
  });

  it("catches the other glyphs a careful writer reaches for", () => {
    expect(nonGsm7Chars("you’ll")).toEqual(["’"]); // curly apostrophe
    expect(nonGsm7Chars("“quoted”")).toEqual(["“", "”"]);
    expect(nonGsm7Chars("wait…")).toEqual(["…"]);
    expect(nonGsm7Chars("• item · item")).toEqual(["•", "·"]);
    expect(nonGsm7Chars("2020–2021")).toEqual(["–"]); // en dash, not a hyphen
  });

  it("accepts the accented and symbol characters that ARE in GSM-7", () => {
    // These look exotic but cost nothing — the point of checking the table rather than ASCII.
    expect(nonGsm7Chars("café über è ù ì ò Ç Ø Å Æ ß É § ¿ ¡ £ ¥ ¤")).toEqual([]);
    // …but the table is narrower than "accented Latin": ï, ë and ø's friends are NOT in it.
    // Checking against the real table is the whole point — "looks European" is not the test.
    expect(nonGsm7Chars("naïve")).toEqual(["ï"]);
    expect(nonGsm7Chars("$50 & 100% @ home")).toEqual([]);
    expect(nonGsm7Chars("^{}[]~|€\\")).toEqual([]); // extension set — 2 septets, still GSM-7
  });

  it("reports each stray once, in order", () => {
    expect(nonGsm7Chars("— a — b ’ c —")).toEqual(["—", "’"]);
  });

  it("excludes interpolated values the body does not own", () => {
    // A customer named with a non-GSM-7 character forces UCS-2 and nothing can be done about
    // it — the copy is still clean, and that is what the body's own test asserts.
    expect(nonGsm7Chars("Hi Łukasz, thanks!", ["Łukasz"])).toEqual([]);
    expect(nonGsm7Chars("Hi Łukasz — thanks!", ["Łukasz"])).toEqual(["—"]);
  });
});
