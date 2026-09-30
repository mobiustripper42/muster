/**
 * The payment link's signature (issue #1082 part B) — `/pay/<reservationId>.<expiry>.<sig>`.
 *
 * Nothing is stored: the link is the whole credential, so these are the only things standing
 * between a guessed URL and a stranger's booking. Valid, tampered, expired and wrong-booking are
 * the four the issue names; the rest are the shapes a hand-edited URL arrives in.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PAYMENT_LINK_HOURS, paymentLinkUrl, signPaymentLink, verifyPaymentLink } from "./payment-link.js";

const SECRET = "test-secret";
const ID = "resv-0123456789abcdef0123456789abcdef";
const T0 = new Date("2026-10-01T12:00:00.000Z");
const hoursAfter = (h: number) => new Date(T0.getTime() + h * 3_600_000);

describe("signPaymentLink / verifyPaymentLink", () => {
  it("a fresh link verifies, names its booking, and lasts 72 hours", () => {
    const token = signPaymentLink(ID, T0, SECRET);
    const res = verifyPaymentLink(token, SECRET, hoursAfter(1));
    expect(res).toEqual({ ok: true, reservationId: ID, expiresAt: hoursAfter(72) });
    expect(PAYMENT_LINK_HOURS).toBe(72);
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
    const later = String(Number(expiry) + 7 * 24 * 3600);
    expect(verifyPaymentLink(`${id}.${later}.${sig}`, SECRET, hoursAfter(100))).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("one booking's signature does not open another booking", () => {
    const [, expiry, sig] = signPaymentLink(ID, T0, SECRET).split(".");
    const other = "resv-ffffffffffffffffffffffffffffffff";
    expect(verifyPaymentLink(`${other}.${expiry}.${sig}`, SECRET, T0)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("a link signed with another secret is refused", () => {
    const token = signPaymentLink(ID, T0, "some-other-secret");
    expect(verifyPaymentLink(token, SECRET, T0)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("an unprefixed HMAC under the same secret is not a payment link", () => {
    // Same HMAC key, different purpose: the payment link signs a prefixed message, so a string
    // signed for anything else under SESSION_SECRET can't be replayed here.
    const token = signPaymentLink(ID, T0, SECRET);
    const [id, expiry] = token.split(".");
    // eslint-disable-next-line sonarjs/hardcoded-secret-signatures -- a test fixture key, not a credential
    const bare = createHmac("sha256", SECRET).update(`${id}.${expiry}`).digest("base64url");
    expect(verifyPaymentLink(`${id}.${expiry}.${bare}`, SECRET, T0)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it.each([
    ["empty", ""],
    ["no dots", "resv-abc"],
    ["one dot", "resv-abc.123"],
    ["empty id", ".1759320000.sig"],
    ["non-numeric expiry", "resv-abc.soon.sig"],
    ["empty signature", "resv-abc.1759320000."],
  ])("a malformed link (%s) is refused", (_label, token) => {
    expect(verifyPaymentLink(token, SECRET, T0)).toEqual({ ok: false, reason: "malformed" });
  });

  it("the URL is the trusted base plus /pay/<token>", () => {
    const token = signPaymentLink(ID, T0, SECRET);
    expect(paymentLinkUrl("https://muster.example", token)).toBe(`https://muster.example/pay/${token}`);
  });
});
