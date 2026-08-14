/**
 * The production gate on the operator's copy of a manage link (#686, recoded at #741).
 *
 * This is the whole security surface of the Copy link affordance. The code it embeds is a live
 * bearer credential — revocable now, but still one paste from a Slack thread — so "off on
 * production" is not a preference, and a gate nobody tests is a gate nobody trusts.
 */
import { describe, it, expect } from "vitest";
import { operatorManageLink } from "./manage-link";
import { isBookingCode, normalizeBookingCode } from "@core/reservations/booking-code.js";

const BASE = "https://muster.example";
const CODE = "K3F9QZ2MX7RN4P";

describe("operatorManageLink", () => {
  it("builds a link off production", () => {
    const url = operatorManageLink({ isProd: false, base: BASE, code: CODE });
    expect(url).toBe("https://muster.example/b/K3F9QZ2MX7RN4P");
  });

  it("returns nothing on production, however well configured", () => {
    // The one case that matters. Everything else here is a config guard; this is the gate.
    expect(operatorManageLink({ isProd: true, base: BASE, code: CODE })).toBeUndefined();
  });

  it("returns nothing without a base URL — never a Host-header fallback", () => {
    expect(operatorManageLink({ isProd: false, base: undefined, code: CODE })).toBeUndefined();
  });

  it("returns nothing when the booking has no live code", () => {
    // An imported booking, or one whose code was revoked and not reissued. The pane must show
    // no link rather than a link to nothing.
    expect(operatorManageLink({ isProd: false, base: BASE, code: undefined })).toBeUndefined();
  });

  it("emits a URL whose last segment the manage page will actually resolve", () => {
    // The acceptance criterion is that the copied URL OPENS the booking. A well-formed URL the
    // page then refuses looks identical on the pane, so check the segment against the same
    // normalizer the route uses rather than against the shape of the string.
    const url = operatorManageLink({ isProd: false, base: BASE, code: CODE })!;
    const segment = new URL(url).pathname.split("/").pop()!;
    expect(isBookingCode(segment)).toBe(true);
    expect(normalizeBookingCode(segment)).toBe(CODE);
  });
});
