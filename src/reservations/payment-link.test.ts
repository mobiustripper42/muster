/**
 * The payment link's signature (issue #1082 part B) — `/p/<id>.<expiry>.<sig>`.
 *
 * Nothing is stored: the link is the whole credential, so these are the only things standing
 * between a guessed URL and a stranger's booking. Valid, tampered, expired and wrong-booking are
 * the four the issue names; the rest are the shapes a hand-edited URL arrives in, and the length —
 * the link is texted, so every character costs (operator, 2026-09-29).
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PAYMENT_LINK_HOURS, paymentLinkUrl, signPaymentLink, verifyPaymentLink } from "./payment-link.js";

const SECRET = "test-secret";
const ID = "resv-0123456789abcdef0123456789abcdef";
const OTHER = "resv-ffffffffffffffffffffffffffffffff";
const T0 = new Date("2026-10-01T12:00:00.000Z");
const hoursAfter = (h: number) => new Date(T0.getTime() + h * 3_600_000);

describe("signPaymentLink / verifyPaymentLink", () => {
  it("a fresh link verifies, names its booking, and lasts 72 hours", () => {
    const token = signPaymentLink(ID, T0, SECRET);
    const res = verifyPaymentLink(token, SECRET, hoursAfter(1));
    expect(res).toEqual({ ok: true, reservationId: ID, expiresAt: hoursAfter(72) });
    expect(PAYMENT_LINK_HOURS).toBe(72);
  });

  it("is short: 22-character id, base-36 expiry, 22-character signature", () => {
    const token = signPaymentLink(ID, T0, SECRET);
    expect(token).toMatch(/^[\w-]{22}\.[0-9a-z]{6}\.[\w-]{22}$/);
    expect(token.length).toBeLessThanOrEqual(52);
    // Not the booking id spelled out — the id is packed, not readable.
    expect(token).not.toContain("resv-");
  });

  it("works up to the last second of its 72 hours and not at the 72nd hour", () => {
    const token = signPaymentLink(ID, T0, SECRET);
    expect(verifyPaymentLink(token, SECRET, new Date(hoursAfter(72).getTime() - 1000)).ok).toBe(true);
    expect(verifyPaymentLink(token, SECRET, hoursAfter(72))).toEqual({ ok: false, reason: "expired" });
  });

  it("a tampered signature is refused", () => {
    const token = signPaymentLink(ID, T0, SECRET);
    const last = token.at(-1) === "A" ? "B" : "A";
    expect(verifyPaymentLink(token.slice(0, -1) + last, SECRET, T0)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("a stretched expiry is refused — the expiry is inside the signature", () => {
    const [id, expiry, sig] = signPaymentLink(ID, T0, SECRET).split(".");
    const later = (parseInt(expiry!, 36) + 7 * 24 * 3600).toString(36);
    expect(verifyPaymentLink(`${id}.${later}.${sig}`, SECRET, hoursAfter(100))).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("one booking's signature does not open another booking", () => {
    const [, expiry, sig] = signPaymentLink(ID, T0, SECRET).split(".");
    const [otherId] = signPaymentLink(OTHER, T0, SECRET).split(".");
    expect(verifyPaymentLink(`${otherId}.${expiry}.${sig}`, SECRET, T0)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("a link signed with another secret is refused", () => {
    const token = signPaymentLink(ID, T0, "some-other-secret");
    expect(verifyPaymentLink(token, SECRET, T0)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("an unprefixed HMAC under the same secret is not a payment link", () => {
    // Same HMAC key, different purpose: the payment link signs a prefixed message, so a string
    // signed for anything else under SESSION_SECRET can't be replayed here.
    const [id, expiry] = signPaymentLink(ID, T0, SECRET).split(".");
    // eslint-disable-next-line sonarjs/hardcoded-secret-signatures -- a test fixture key, not a credential
    const bare = createHmac("sha256", SECRET).update(`${ID}:${parseInt(expiry!, 36)}`).digest().subarray(0, 16);
    expect(verifyPaymentLink(`${id}.${expiry}.${bare.toString("base64url")}`, SECRET, T0)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("a second spelling of the same id is refused rather than accepted as the same link", () => {
    // 22 base64url characters carry 132 bits for 128, so the last one has spare bits; only the
    // canonical spelling is the link.
    const [id, expiry, sig] = signPaymentLink(ID, T0, SECRET).split(".");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const bumped = alphabet[alphabet.indexOf(id!.at(-1)!) ^ 1]!;
    expect(verifyPaymentLink(`${id!.slice(0, -1)}${bumped}.${expiry}.${sig}`, SECRET, T0)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it.each([
    ["empty", ""],
    ["no dots", "ASNFZ4mrze8BI0VniavN7w"],
    ["one dot", "ASNFZ4mrze8BI0VniavN7w.tzq8xy"],
    ["the old long form", `${ID}.1790996950.Qf5LdfzEPc-7QD1VqiMPmoEsxOiMVkq3FkrdrGFxYlA`],
    ["short id", "ASNFZ4mrze8.tzq8xy.Qf5LdfzEPc-7QD1VqiMPmo"],
    ["expiry not base 36", "ASNFZ4mrze8BI0VniavN7w.TZQ8XY.Qf5LdfzEPc-7QD1VqiMPmo"],
    ["short signature", "ASNFZ4mrze8BI0VniavN7w.tzq8xy.Qf5Ldf"],
  ])("a malformed link (%s) is refused", (_label, token) => {
    expect(verifyPaymentLink(token, SECRET, T0)).toEqual({ ok: false, reason: "malformed" });
  });

  it("only an operator booking's id shape can be signed", () => {
    expect(() => signPaymentLink("resv-demo-2026-10-05-15:30", T0, SECRET)).toThrow(/resv-<32 hex>/);
  });

  it("the URL is the trusted base plus /p/<token>", () => {
    const token = signPaymentLink(ID, T0, SECRET);
    expect(paymentLinkUrl("https://muster.example", token)).toBe(`https://muster.example/p/${token}`);
  });
});
