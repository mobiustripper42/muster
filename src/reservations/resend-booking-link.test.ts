/**
 * Resending a booking link (#686).
 *
 * The confirmation emit (`sendBookingConfirmation`) returns `void` — right for a webhook, where
 * nobody is watching and a failed send must not 500. This is the opposite situation: an operator
 * pressed a button and is standing there, so the one thing that must not happen is a green
 * "sent" over a send that did not happen. Every case below is about the per-channel outcome
 * being reported truthfully.
 */
import { describe, it, expect } from "vitest";
import type { ChannelPort, OutboundMessage } from "../ports/channel.js";
import type { Reservation } from "../domain/entities.js";
import { resendBookingLink, resendBookingLinkBody } from "./resend-booking-link.js";
import { nonGsm7Chars } from "./sms-alphabet.js";

const DEPS = { linkBase: "https://muster.example" };
const CODE = "K3F9QZ2MX7RN4P";

function reservation(over: Record<string, unknown> = {}): Reservation {
  return {
    id: "resv-1",
    customerName: "Marcus Webb",
    email: "marcus@example.com",
    phone: "+15555550123",
    partySize: 6,
    ...over,
  } as unknown as Reservation;
}

/** Records what it was handed; optionally throws to simulate a rejecting medium. */
function channel(opts: { throws?: boolean } = {}): ChannelPort & { sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = [];
  return {
    sent,
    async send(msg: OutboundMessage) {
      if (opts.throws) throw new Error("medium rejected it");
      sent.push(msg);
      return { ok: true } as never;
    },
  } as ChannelPort & { sent: OutboundMessage[] };
}

describe("resendBookingLink", () => {
  it("sends on both channels the reservation has, and reports both", async () => {
    const email = channel();
    const sms = channel();
    const r = await resendBookingLink({ ...DEPS, email, sms }, reservation(), CODE);
    expect(r).toEqual({ email: "sent", sms: "sent" });
    expect(email.sent).toHaveLength(1);
    expect(sms.sent).toHaveLength(1);
  });

  it("carries the manage URL for THIS reservation in the body", async () => {
    const email = channel();
    await resendBookingLink({ ...DEPS, email }, reservation(), CODE);
    expect(email.sent[0]!.body).toContain(`https://muster.example/b/${CODE}`);
  });

  it("reports a channel the reservation has no contact for as absent, not sent", async () => {
    // A phone-only booking must not report an email as sent. The operator reads this to decide
    // whether to pick up the phone.
    const email = channel();
    const sms = channel();
    const r = await resendBookingLink({ ...DEPS, email, sms }, reservation({ email: undefined }), CODE);
    expect(r).toEqual({ email: "absent", sms: "sent" });
    expect(email.sent).toHaveLength(0);
  });

  it("reports a channel that is not configured at all as absent", async () => {
    const r = await resendBookingLink({ ...DEPS, email: channel() }, reservation(), CODE);
    expect(r.sms).toBe("absent");
  });

  it("reports a rejecting channel as failed — never as sent", async () => {
    const r = await resendBookingLink({ ...DEPS, email: channel({ throws: true }) }, reservation(), CODE);
    expect(r.email).toBe("failed");
  });

  it("still tries the second channel when the first throws", async () => {
    // The failure mode: one dead medium silently swallowing the other. An operator told
    // "email failed" would assume the text went; it must actually have been attempted.
    const sms = channel();
    const r = await resendBookingLink(
      { ...DEPS, email: channel({ throws: true }), sms },
      reservation(),
      CODE,
    );
    expect(r).toEqual({ email: "failed", sms: "sent" });
    expect(sms.sent).toHaveLength(1);
  });

  it("never throws, even with every channel rejecting", async () => {
    await expect(
      resendBookingLink(
        { ...DEPS, email: channel({ throws: true }), sms: channel({ throws: true }) },
        reservation(),
        CODE,
      ),
    ).resolves.toEqual({ email: "failed", sms: "failed" });
  });

  it("surfaces each failure to onFailure rather than swallowing it", async () => {
    const seen: string[] = [];
    await resendBookingLink(
      { ...DEPS, email: channel({ throws: true }), onFailure: (d) => seen.push(d) },
      reservation(),
      CODE,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("resv-1");
  });
});

describe("resendBookingLinkBody", () => {
  it("stays inside GSM-7", () => {
    // The body ships verbatim as SMS. One character outside GSM-7 re-encodes the WHOLE message
    // as UCS-2 — 67 chars per segment instead of 153. An em dash did exactly that at #619.
    // `ignore` the interpolated name, per `sms-alphabet.ts` and both sibling tests
    // (`sold-out-notice.test.ts`, `booking-confirmation.test.ts`): a customer's own name can
    // legitimately force UCS-2 and is not ours to control. Without it this asserts the fixture
    // name happens to be ASCII rather than the TEMPLATE's own GSM-7 safety, which is the thing
    // under test.
    const r = reservation({ customerName: "Zoë Ångström" });
    const body = resendBookingLinkBody(r, "https://muster.example/b/K3F9QZ2MX7RN4P");
    expect(nonGsm7Chars(body, ["Zoë"])).toEqual([]);
  });

  it("does not claim the booking was just made — this is a resend, not a confirmation", () => {
    const body = resendBookingLinkBody(reservation(), "https://x/y");
    expect(body).not.toMatch(/just booked|is confirmed/i);
  });
});
