/**
 * Booking confirmation emit (11.4, DEC-122) — best-effort email + SMS.
 */
import { describe, expect, it, vi } from "vitest";
import type { Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { ChannelPort, OutboundMessage, SendResult } from "../ports/channel.js";
import { verifyReservationLinkToken } from "./booking-link.js";
import { sendBookingConfirmation } from "./booking-confirmation.js";

const SECRET = "test-link-secret";
const BASE = "https://muster.app";

/** A ChannelPort that records what it was handed (and can be made to throw). */
function capturing(throwOnSend = false): ChannelPort & { sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = [];
  return {
    sent,
    async send(m: OutboundMessage): Promise<SendResult> {
      if (throwOnSend) throw new Error("channel down");
      sent.push(m);
      return { deliveredAt: "2026-07-13T00:00:00.000Z" };
    },
  };
}

// `null` omits a contact field (exactOptionalPropertyTypes forbids passing
// `undefined`); default keeps both present.
const reservation = (
  opts: { email?: string | null; phone?: string | null } = {},
): Reservation => {
  const email = opts.email === undefined ? "mary@example.com" : opts.email;
  const phone = opts.phone === undefined ? "+15550001111" : opts.phone;
  return {
    id: asId<"ReservationId">("resv-xyz"),
    eventId: asId<"EventId">("m-evt-1"),
    source: "muster",
    customerName: "Mary",
    partySize: 6,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    status: "booked",
  };
};

describe("sendBookingConfirmation", () => {
  it("emails and texts, both carrying the verifiable manage link", async () => {
    const email = capturing();
    const sms = capturing();
    const res = reservation();

    await sendBookingConfirmation({ email, sms, linkBase: BASE, linkSecret: SECRET }, res);

    expect(email.sent).toHaveLength(1);
    expect(sms.sent).toHaveLength(1);
    for (const chan of [email, sms]) {
      const msg = chan.sent[0]!;
      expect(msg.kind).toBe("receipt");
      // The URL is inline in the body (not a separate `link` field that only SMS
      // appends) so email carries it too.
      const url = msg.body.match(/https:\/\/\S+/)![0];
      const token = new URL(url).searchParams.get("t")!;
      expect(verifyReservationLinkToken(res.id, SECRET, token)).toBe(true);
    }
    expect(email.sent[0]!.to).toEqual({ email: "mary@example.com" });
    expect(sms.sent[0]!.to).toEqual({ phone: "+15550001111" });
  });

  it("email-only reservation ⇒ only the email side fires", async () => {
    const email = capturing();
    const sms = capturing();
    await sendBookingConfirmation(
      { email, sms, linkBase: BASE, linkSecret: SECRET },
      reservation({ phone: null }),
    );
    expect(email.sent).toHaveLength(1);
    expect(sms.sent).toHaveLength(0);
  });

  it("phone-only reservation ⇒ only the SMS side fires", async () => {
    const email = capturing();
    const sms = capturing();
    await sendBookingConfirmation(
      { email, sms, linkBase: BASE, linkSecret: SECRET },
      reservation({ email: null }),
    );
    expect(email.sent).toHaveLength(0);
    expect(sms.sent).toHaveLength(1);
  });

  it("a channel present but the contact field missing ⇒ that side is skipped", async () => {
    const sms = capturing();
    // email channel configured, but the reservation has no email.
    const email = capturing();
    await sendBookingConfirmation(
      { email, sms, linkBase: BASE, linkSecret: SECRET },
      reservation({ email: null, phone: null }),
    );
    expect(email.sent).toHaveLength(0);
    expect(sms.sent).toHaveLength(0);
  });

  it("best-effort: a failing channel is swallowed + surfaced, the other still sends", async () => {
    const email = capturing(true); // throws
    const sms = capturing();
    const onFailure = vi.fn();

    await expect(
      sendBookingConfirmation(
        { email, sms, linkBase: BASE, linkSecret: SECRET, onFailure },
        reservation(),
      ),
    ).resolves.toBeUndefined(); // never throws — a paid booking must not 500 the webhook

    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure.mock.calls[0]![0]).toContain("email confirmation");
    expect(sms.sent).toHaveLength(1); // the SMS side still went out
  });
});
