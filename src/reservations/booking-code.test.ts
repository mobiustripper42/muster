/**
 * The booking code (#741, DEC-154) — the credential half of the short manage link.
 */
import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { BookingCode } from "../domain/entities.js";
import {
  BOOKING_CODE_ALPHABET,
  BOOKING_CODE_LENGTH,
  bookingCodeRefusal,
  bookingUrl,
  isBookingCode,
  mintBookingCode,
  normalizeBookingCode,
} from "./booking-code.js";

/** A byte source that counts up — pins the output without pretending to be random. */
const counting = (start = 0) => (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => start + i));

const row = (over: Partial<BookingCode> = {}): BookingCode => ({
  code: "K3F9QZ2MX7RN4P",
  reservationId: asId<"ReservationId">("resv-1"),
  createdAt: "2026-08-01T00:00:00.000Z",
  ...over,
});

describe("mintBookingCode", () => {
  it("is 14 characters, all from the Crockford alphabet", () => {
    const code = mintBookingCode();
    expect(code).toHaveLength(BOOKING_CODE_LENGTH);
    expect(code).toMatch(new RegExp(`^[${BOOKING_CODE_ALPHABET}]+$`));
  });

  it("excludes the characters that collide when read aloud (I, L, O, U)", () => {
    // Not a property of one mint — a property of the alphabet, which is what a caller relies on
    // when a customer reads a code off a text over the phone.
    expect(BOOKING_CODE_ALPHABET).not.toMatch(/[ILOU]/);
    expect(BOOKING_CODE_ALPHABET).toHaveLength(32);
  });

  it("maps every byte value onto the alphabet without bias", () => {
    // 256 / 32 = 8, so each character must come up exactly 8 times across a full byte sweep.
    // A modulo over a non-power-of-two alphabet would skew the first few characters; this is the
    // test that would catch someone "simplifying" the mask into `% ALPHABET.length`.
    const counts = new Map<string, number>();
    for (let byte = 0; byte < 256; byte++) {
      // One byte value at a time, so the character it maps to is unambiguous.
      const ch = mintBookingCode((n) => Buffer.from(Array.from({ length: n }, () => byte)))[0]!;
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect([...counts.keys()].sort().join("")).toBe([...BOOKING_CODE_ALPHABET].sort().join(""));
    expect([...new Set(counts.values())]).toEqual([8]);
  });

  it("two mints differ", () => {
    expect(mintBookingCode()).not.toBe(mintBookingCode());
  });

  it("is deterministic under an injected byte source (so the seed can pin one)", () => {
    expect(mintBookingCode(counting(0))).toBe(mintBookingCode(counting(0)));
    expect(mintBookingCode(counting(0))).not.toBe(mintBookingCode(counting(1)));
  });
});

describe("normalizeBookingCode", () => {
  it("uppercases and folds the ambiguous characters a human re-types", () => {
    expect(normalizeBookingCode("k3f9qz2mx7rn4p")).toBe("K3F9QZ2MX7RN4P");
    // I/L → 1 and O → 0: the code never CONTAINS them, so a presented one is a misread.
    expect(normalizeBookingCode("K3F9QZ2MX7RN4O")).toBe("K3F9QZ2MX7RN40");
    expect(normalizeBookingCode("K3F9QZ2MX7RN4I")).toBe("K3F9QZ2MX7RN41");
    expect(normalizeBookingCode("K3F9-QZ2M X7RN4P")).toBe("K3F9QZ2MX7RN4P");
  });

  it("refuses anything that cannot be a code, without touching the database", () => {
    expect(normalizeBookingCode("")).toBeNull();
    expect(normalizeBookingCode(undefined)).toBeNull();
    expect(normalizeBookingCode("TOOSHORT")).toBeNull();
    expect(normalizeBookingCode("K3F9QZ2MX7RN4PEXTRA")).toBeNull();
    expect(normalizeBookingCode("../../etc/passwd")).toBeNull();
  });

  it("round-trips a freshly minted code", () => {
    const code = mintBookingCode();
    expect(normalizeBookingCode(code)).toBe(code);
    expect(isBookingCode(code)).toBe(true);
  });
});

describe("bookingUrl", () => {
  it("is 43 characters against the production origin — the #741 acceptance number", () => {
    const url = bookingUrl("https://muster.brewcle.com", "K3F9QZ2MX7RN4P");
    expect(url).toBe("https://muster.brewcle.com/b/K3F9QZ2MX7RN4P");
    expect(url).toHaveLength(43);
  });

  it("tolerates a trailing slash on the base", () => {
    expect(bookingUrl("https://muster.app/", "K3F9QZ2MX7RN4P")).toBe("https://muster.app/b/K3F9QZ2MX7RN4P");
  });
});

describe("bookingCodeRefusal", () => {
  const NOW = "2026-08-14T00:00:00.000Z";

  it("a live code opens the booking", () => {
    expect(bookingCodeRefusal(row(), NOW)).toBeNull();
  });

  it("a revoked code refuses as `revoked` — the reissue killed it", () => {
    expect(bookingCodeRefusal(row({ revokedAt: "2026-08-13T00:00:00.000Z" }), NOW)).toBe("revoked");
  });

  it("expiry is enforced when set, and unset means no expiry", () => {
    // Nothing mints an expiring code today (a manage page must stay open for the post-trip tip
    // and the receipt); the column exists so that policy is a value rather than a migration.
    expect(bookingCodeRefusal(row({ expiresAt: "2026-08-13T23:59:59.000Z" }), NOW)).toBe("expired");
    expect(bookingCodeRefusal(row({ expiresAt: "2026-08-14T00:00:01.000Z" }), NOW)).toBeNull();
    expect(bookingCodeRefusal(row({}), NOW)).toBeNull();
  });

  it("revocation wins over expiry — both true reports the deliberate act", () => {
    const both = row({ revokedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2026-08-02T00:00:00.000Z" });
    expect(bookingCodeRefusal(both, NOW)).toBe("revoked");
  });
});
