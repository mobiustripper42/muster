/**
 * Customer identity (12.12b, DEC-132) — canonicalization is the UNIQUE key, so the cases that
 * matter are the ones where two inputs must (or must not) collapse to one key.
 */
import { describe, expect, it } from "vitest";
import {
  CROCKFORD_ALPHABET,
  canonicalizePhone,
  formatPhoneForDisplay,
  isCanonicalizablePhone,
  isDisplayCode,
  mintDisplayCode,
  parseDisplayCode,
  phoneRejectionMessage,
  type PhoneRejection,
} from "./identity.js";

const ok = (raw: string) => {
  const r = canonicalizePhone(raw);
  if (!r.ok) throw new Error(`expected ${raw} to canonicalize, got ${r.reason}`);
  return r.phone;
};
const reason = (raw: string | undefined | null): PhoneRejection | "OK" => {
  const r = canonicalizePhone(raw);
  return r.ok ? "OK" : r.reason;
};

describe("canonicalizePhone — the identity key", () => {
  it("collapses every human spelling of one number to a single key", () => {
    const forms = [
      "2165550148",
      "216-555-0148",
      "(216) 555-0148",
      " (216) 555 0148 ",
      "216.555.0148",
      "12165550148",
      "1 (216) 555-0148",
      "+12165550148",
      "+1 216 555 0148",
    ];
    const keys = new Set(forms.map(ok));
    expect([...keys]).toEqual(["+12165550148"]);
  });

  it("keeps different numbers apart", () => {
    expect(ok("2165550148")).not.toBe(ok("2165550149"));
  });

  it("rejects an empty or absent phone", () => {
    expect(reason("")).toBe("empty");
    expect(reason("   ")).toBe("empty");
    expect(reason(undefined)).toBe("empty");
    expect(reason(null)).toBe("empty");
  });

  it("rejects a short number rather than padding it into someone else's key", () => {
    expect(reason("555-0148")).toBe("too_short");
    expect(reason("216555014")).toBe("too_short");
  });

  it("rejects bare digits that aren't NANP instead of guessing +1", () => {
    // 12 bare digits is not a US number; prefixing +1 would mint a wrong identity.
    expect(reason("442071838750")).toBe("unsupported_country");
  });

  it("rejects structurally impossible NANP numbers (the realistic typo)", () => {
    expect(reason("0165550148")).toBe("not_dialable"); // area code can't start 0
    expect(reason("1165550148")).toBe("not_dialable"); // ...or 1
    expect(reason("2161550148")).toBe("not_dialable"); // exchange can't start 1
  });

  it("trusts an explicit + as international intent", () => {
    expect(ok("+44 20 7183 8750")).toBe("+442071838750");
    expect(ok("+33 1 42 68 53 00")).toBe("+33142685300");
  });

  it("bounds an explicit + by E.164's 15-digit ceiling", () => {
    expect(reason("+1234567")).toBe("too_short");
    expect(reason("+1234567890123456")).toBe("too_long");
  });

  it("ignores extension-looking junk consistently (documented, not endorsed)", () => {
    // Non-digits are stripped wholesale, so an extension glues on and fails the length gate
    // rather than silently keying the main number. Pinned so the behavior is a decision.
    expect(reason("216-555-0148 x123")).toBe("unsupported_country");
  });

  it("isCanonicalizablePhone mirrors the result", () => {
    expect(isCanonicalizablePhone("216-555-0148")).toBe(true);
    expect(isCanonicalizablePhone("555")).toBe(false);
  });
});

describe("phoneRejectionMessage", () => {
  it("gives every rejection a one-sentence operator-facing message", () => {
    const reasons: PhoneRejection[] = [
      "empty",
      "too_short",
      "too_long",
      "not_dialable",
      "unsupported_country",
    ];
    for (const r of reasons) {
      const msg = phoneRejectionMessage(r);
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).toMatch(/\.$|\?$/);
    }
  });
});

describe("formatPhoneForDisplay", () => {
  it("formats a NANP number the way an operator reads it", () => {
    expect(formatPhoneForDisplay("+12165550148")).toBe("(216) 555-0148");
  });
  it("passes an international number through untouched", () => {
    expect(formatPhoneForDisplay("+442071838750")).toBe("+442071838750");
  });
});

describe("display code (Crockford base32)", () => {
  it("excludes the ambiguous characters I, L, O and U", () => {
    for (const c of "ILOU") expect(CROCKFORD_ALPHABET).not.toContain(c);
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
  });

  it("mints a well-formed code", () => {
    const code = mintDisplayCode(() => 0.5);
    expect(code).toMatch(/^C-[0-9A-Z]{6}$/);
    expect(isDisplayCode(code)).toBe(true);
  });

  it("is deterministic under injected randomness — same draws, same code", () => {
    const seq = [0, 0.25, 0.5, 0.75, 0.99, 0.125];
    const stub = () => {
      let i = 0;
      return () => seq[i++]!;
    };
    expect(mintDisplayCode(stub())).toBe(mintDisplayCode(stub()));
    expect(mintDisplayCode(() => 0)).toBe("C-000000");
  });

  it("never indexes off the end when randomness returns its ceiling", () => {
    expect(isDisplayCode(mintDisplayCode(() => 0.999999999))).toBe(true);
    expect(isDisplayCode(mintDisplayCode(() => 1))).toBe(true);
  });

  it("draws from the full alphabet across many mints", () => {
    let i = 0;
    // Walk the alphabet deterministically: 32 mints × 6 chars covers every index.
    const code = () => mintDisplayCode(() => (i++ % 32) / 32);
    const seen = new Set([...Array(32)].flatMap(() => code().slice(2).split("")));
    expect(seen.size).toBe(32);
  });

  it("rejects malformed codes", () => {
    expect(isDisplayCode("C-K7X3P")).toBe(false); // too short
    expect(isDisplayCode("C-K7X3P99")).toBe(false); // too long
    expect(isDisplayCode("K7X3P9")).toBe(false); // no prefix
    expect(isDisplayCode("C-K7X3PI")).toBe(false); // excluded letter
    expect(isDisplayCode("xC-K7X3P9")).toBe(false); // anchored
  });
});

describe("parseDisplayCode — what the operator types off a phone call", () => {
  it("accepts the canonical form", () => {
    expect(parseDisplayCode("C-K7X3P9")).toBe("C-K7X3P9");
  });
  it("accepts it lowercase, unprefixed, or spaced", () => {
    expect(parseDisplayCode("c-k7x3p9")).toBe("C-K7X3P9");
    expect(parseDisplayCode("k7x3p9")).toBe("C-K7X3P9");
    expect(parseDisplayCode("  C K7X3P9 ")).toBe("C-K7X3P9");
  });
  it("folds the characters the alphabet deliberately excludes", () => {
    // Someone reads "C-K7X3PO" aloud; the real code has a zero.
    expect(parseDisplayCode("C-K7X3PO")).toBe("C-K7X3P0");
    expect(parseDisplayCode("C-I7X3P9")).toBe("C-17X3P9");
    expect(parseDisplayCode("C-L7X3P9")).toBe("C-17X3P9");
  });
  it("returns null for something that can't be a code", () => {
    expect(parseDisplayCode("")).toBeNull();
    expect(parseDisplayCode("C-123")).toBeNull();
    expect(parseDisplayCode("not a code at all")).toBeNull();
  });
});
