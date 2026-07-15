/**
 * The stateless-HMAC booking capability URL (11.4, DEC-122).
 */
import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import {
  reservationLinkToken,
  reservationManageUrl,
  verifyReservationLinkToken,
} from "./booking-link.js";

const RES = asId<"ReservationId">("resv-abc123");
const SECRET = "test-reservation-link-secret";

describe("reservationLinkToken", () => {
  it("is deterministic — same id + secret ⇒ same token (re-openable capability)", () => {
    expect(reservationLinkToken(RES, SECRET)).toBe(reservationLinkToken(RES, SECRET));
  });

  it("is base64url (URL-safe: no +, /, =)", () => {
    expect(reservationLinkToken(RES, SECRET)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("differs by reservation id", () => {
    const other = asId<"ReservationId">("resv-different");
    expect(reservationLinkToken(RES, SECRET)).not.toBe(reservationLinkToken(other, SECRET));
  });

  it("differs by secret — rotating the secret invalidates every link", () => {
    expect(reservationLinkToken(RES, SECRET)).not.toBe(
      reservationLinkToken(RES, "a-different-secret"),
    );
  });
});

describe("verifyReservationLinkToken", () => {
  it("accepts the token it minted", () => {
    const token = reservationLinkToken(RES, SECRET);
    expect(verifyReservationLinkToken(RES, SECRET, token)).toBe(true);
  });

  it("rejects a tampered token", () => {
    const token = reservationLinkToken(RES, SECRET);
    expect(verifyReservationLinkToken(RES, SECRET, `${token}x`)).toBe(false);
    expect(verifyReservationLinkToken(RES, SECRET, "")).toBe(false);
  });

  it("rejects a token for a different reservation (can't swap the id in the URL)", () => {
    const token = reservationLinkToken(RES, SECRET);
    const other = asId<"ReservationId">("resv-different");
    expect(verifyReservationLinkToken(other, SECRET, token)).toBe(false);
  });

  it("rejects a token minted under a rotated secret", () => {
    const token = reservationLinkToken(RES, "old-secret");
    expect(verifyReservationLinkToken(RES, SECRET, token)).toBe(false);
  });
});

describe("reservationManageUrl", () => {
  it("carries the reservation id and a matching token, at the manage path", () => {
    const url = reservationManageUrl("https://muster.app", RES, SECRET);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://muster.app/reservations/manage");
    expect(parsed.searchParams.get("r")).toBe(RES);
    expect(verifyReservationLinkToken(RES, SECRET, parsed.searchParams.get("t")!)).toBe(true);
  });

  it("strips a trailing slash on the base (no double slash)", () => {
    const url = reservationManageUrl("https://muster.app/", RES, SECRET);
    expect(url).toContain("https://muster.app/reservations/manage?");
  });

  it("url-encodes a reservation id with reserved characters", () => {
    const weird = asId<"ReservationId">("resv a/b");
    const url = reservationManageUrl("https://muster.app", weird, SECRET);
    expect(new URL(url).searchParams.get("r")).toBe("resv a/b");
  });
});
