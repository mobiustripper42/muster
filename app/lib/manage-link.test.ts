/**
 * The production gate on the operator's copy of a manage link (#686).
 *
 * This is the whole security surface of the Copy link affordance. The token it embeds never
 * expires and cannot be revoked, so "off on production" is not a preference — and a gate nobody
 * tests is a gate nobody trusts.
 */
import { describe, it, expect } from "vitest";
import { operatorManageLink } from "./manage-link";
import { verifyReservationLinkToken } from "@core/reservations/booking-link.js";
import { asId } from "@core/domain/ids.js";

const BASE = "https://muster.example";
const SECRET = "s3cret";

describe("operatorManageLink", () => {
  it("builds a link off production", () => {
    const url = operatorManageLink({ isProd: false, base: BASE, secret: SECRET, reservationId: "resv-1" });
    expect(url).toContain("https://muster.example/reservations/manage?r=resv-1&t=");
  });

  it("returns nothing on production, however well configured", () => {
    // The one case that matters. Everything else here is a config guard; this is the gate.
    expect(
      operatorManageLink({ isProd: true, base: BASE, secret: SECRET, reservationId: "resv-1" }),
    ).toBeUndefined();
  });

  it("returns nothing without a base URL — never a Host-header fallback", () => {
    expect(
      operatorManageLink({ isProd: false, base: undefined, secret: SECRET, reservationId: "resv-1" }),
    ).toBeUndefined();
  });

  it("returns nothing without the link secret", () => {
    expect(
      operatorManageLink({ isProd: false, base: BASE, secret: undefined, reservationId: "resv-1" }),
    ).toBeUndefined();
  });

  it("mints a token the manage page will actually accept", () => {
    // The acceptance criterion is that the copied URL OPENS the booking. A well-formed URL that
    // the page then refuses looks identical on the pane, so verify against the real verifier
    // rather than against the shape of the string.
    const url = operatorManageLink({ isProd: false, base: BASE, secret: SECRET, reservationId: "resv-1" })!;
    const token = new URL(url).searchParams.get("t")!;
    expect(verifyReservationLinkToken(asId<"ReservationId">("resv-1"), SECRET, token)).toBe(true);
  });

  it("does not accept that token for a different reservation", () => {
    const url = operatorManageLink({ isProd: false, base: BASE, secret: SECRET, reservationId: "resv-1" })!;
    const token = new URL(url).searchParams.get("t")!;
    expect(verifyReservationLinkToken(asId<"ReservationId">("resv-2"), SECRET, token)).toBe(false);
  });
});
