/**
 * The resend outcome copy (#686).
 *
 * `app/**` is in the vitest include, and this is the layer where the lie lived: the action
 * always redirected `resent=1`, so `actionMessage` had one string — "Confirmation and manage
 * link sent again." — and printed it whether two channels went, one went, or the deployment had
 * no channels at all.
 *
 * The rule every case here encodes: **the operator must never be told more went out than did.**
 * They are usually on the phone to the customer when they press it.
 */
import { describe, it, expect } from "vitest";
import { actionMessage } from "./reservation-detail-pane";

const CONTACTS = { email: "marcus@example.com", phone: "+1 216 555 0148" };

describe("actionMessage — resent", () => {
  it("names both contacts when both channels went", () => {
    const m = actionMessage("resent", "sent-sent", CONTACTS);
    expect(m).toContain("marcus@example.com");
    expect(m).toContain("+1 216 555 0148");
  });

  it("says which contact is missing rather than implying both went", () => {
    // The seed booking's exact shape: a phone, no email. Silence about the email would read as
    // "we emailed them too".
    const m = actionMessage("resent", "absent-sent", { phone: CONTACTS.phone });
    expect(m).toContain("+1 216 555 0148");
    expect(m).toContain("No email on this booking");
    expect(m).not.toContain("emailed");
  });

  it("says a contact was not tried when the deployment has no channel for it", () => {
    // The gap: `absent` means EITHER the booking has no such contact OR this deployment has no
    // channel configured for it. Both render as "we didn't send there", and only the first was
    // being reported. On a half-configured deployment (email up, Twilio down) the operator saw
    // "Link emailed X." with no hint that a phone number sat there untried — not a false success,
    // but the one fact they need to decide whether to also pick up the phone.
    const m = actionMessage("resent", "sent-absent", CONTACTS);
    expect(m).toContain("marcus@example.com");
    expect(m).toMatch(/not tried|no SMS/i);
  });

  it("reports a partial failure as a failure, alongside what did get out", () => {
    const m = actionMessage("resent", "failed-sent", CONTACTS);
    expect(m).toContain("+1 216 555 0148");
    expect(m).toContain("the email failed");
  });

  it("never renders a channel that failed as a contact it reached", () => {
    const m = actionMessage("resent", "sent-failed", CONTACTS);
    expect(m).toContain("marcus@example.com");
    expect(m).toContain("the text failed");
    // The phone number must not appear as somewhere the link was delivered.
    expect(m).not.toContain("texted +1 216 555 0148");
  });
});

describe("actionMessage — resendErr", () => {
  /**
   * These three mean NOTHING was attempted — a property of the deployment, not of the booking.
   * A retry changes nothing until the deployment does, so the copy must not read like a
   * transient blip inviting a second press.
   */
  it.each([
    ["messaging_off", /switched off/i],
    ["not_configured", /APP_BASE_URL/],
    ["no_channels", /No email or SMS channel is configured/i],
  ])("explains %s as a deployment fact", (code, pattern) => {
    const m = actionMessage("resendErr", code);
    expect(m).toMatch(pattern);
    expect(m).toContain("nothing was sent");
    expect(m).not.toMatch(/try again/i);
  });

  it("distinguishes every-channel-failed from nothing-was-attempted", () => {
    const m = actionMessage("resendErr", "all_failed");
    expect(m).toMatch(/Nothing got out/);
  });

  it("still explains the booking-level refusals it always did", () => {
    expect(actionMessage("resendErr", "cancelled")).toMatch(/isn’t sailing/);
    expect(actionMessage("resendErr", "not_muster")).toMatch(/Xola/);
    expect(actionMessage("resendErr", "no_contact")).toMatch(/nowhere to send/);
  });
});
