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

  it("returns nothing on production by default", () => {
    // The resting state. A live bearer credential must not sit on the operator's screen for
    // every booking they open, where it lands in screenshots and over-the-shoulder glances.
    expect(operatorManageLink({ isProd: true, base: BASE, code: CODE })).toBeUndefined();
  });

  it("DOES return the link on production immediately after a reissue", () => {
    // The whole of the change. A code the operator just deliberately minted, one action ago, is
    // a link they intended to hand over — so they can read it down the phone (14 Crockford
    // characters, chosen to be sayable) or paste it. The customer's previous link is already
    // dead by then, because a reissue revokes it, so this reveals nothing that outlived the
    // decision to reveal it.
    //
    // It also un-strands the worst outcome: when the reissue's send fails (no channel
    // configured, Twilio down), the operator now has the new link in front of them instead of
    // a notice telling them the customer has no working link and to call them.
    expect(
      operatorManageLink({ isProd: true, base: BASE, code: CODE, justReissued: true }),
    ).toBe("https://muster.example/b/K3F9QZ2MX7RN4P");
  });

  it("the reveal does NOT survive a reload — it is scoped to the action, not the session", () => {
    // `justReissued` comes from the post-action redirect's own params. Reloading the pane
    // without them puts the link away again, so a tab left open on a booking is not a tab
    // sitting on a credential.
    expect(operatorManageLink({ isProd: true, base: BASE, code: CODE, justReissued: false })).toBeUndefined();
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
