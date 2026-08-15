/**
 * Booking confirmation emit (11.4, DEC-122) — best-effort email + SMS.
 */
import { describe, expect, it, vi } from "vitest";
import type { Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { ChannelPort, OutboundMessage, SendResult } from "../ports/channel.js";
import { sendBookingConfirmation } from "./booking-confirmation.js";
import { CANCELLATION_TERMS_SHORT } from "./refund-terms.js";
import { nonGsm7Chars } from "./sms-alphabet.js";

const BASE = "https://muster.app";
/** The real production origin — the length assertion is only honest against it. */
const PROD_BASE = "https://muster.brewcle.com";
const CODE = "K3F9QZ2MX7RN4P";

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
  it("emails and texts, both carrying the manage link", async () => {
    const email = capturing();
    const sms = capturing();
    const res = reservation();

    await sendBookingConfirmation({ email, sms, linkBase: BASE }, res, CODE);

    expect(email.sent).toHaveLength(1);
    expect(sms.sent).toHaveLength(1);
    for (const chan of [email, sms]) {
      const msg = chan.sent[0]!;
      expect(msg.kind).toBe("receipt");
      // The URL is inline in the body (not a separate `link` field that only SMS
      // appends) so email carries it too.
      const url = msg.body.match(/https:\/\/\S+/)![0];
      expect(url).toBe(`${BASE}/b/${CODE}`);
    }
    expect(email.sent[0]!.to).toEqual({ email: "mary@example.com" });
    expect(sms.sent[0]!.to).toEqual({ phone: "+15550001111" });
  });

  it("the manage link is a short /b/<code> URL, not a 129-character HMAC (#741)", async () => {
    // The link ships in the confirmation SMS, where length is billed in segments. A stored
    // short code replaces the stateless HMAC (DEC-154 reverses DEC-122's mechanism): the id
    // and the 43-char token both leave the URL, taking it from 129 characters to 43.
    const email = capturing();
    const sms = capturing();

    await sendBookingConfirmation({ email, sms, linkBase: PROD_BASE }, reservation(), CODE);

    for (const chan of [email, sms]) {
      const url = chan.sent[0]!.body.match(/https:\/\/\S+/)![0];
      expect(url).toBe(`${PROD_BASE}/b/${CODE}`);
      // The two contributors the code removes. Asserted by absence because either one
      // reappearing (a stray `pastTrips`-style href, a half-migrated caller) puts the
      // length straight back.
      expect(url).not.toContain("?r=");
      expect(url).not.toContain("&t=");
      // The acceptance number, measured against the REAL production origin — not the
      // shorter test base, which would let a regression pass here and fail in the SMS.
      expect(url.length).toBeLessThanOrEqual(43);
    }
  });

  it("the body stays inside GSM-7 — one stray character doubles every SMS bill", async () => {
    // The em dash in the sign-off did exactly this until #619: a single non-GSM-7 character
    // re-encodes the WHOLE message as UCS-2, 67 chars per concatenated segment instead of 153.
    // The failure is invisible — the text still sends, it just costs more, forever.
    const sms = capturing();
    const res = reservation();
    await sendBookingConfirmation({ sms, linkBase: BASE }, res, CODE);

    // The customer's own name can force UCS-2 and is not ours to control — check the copy
    // this body owns, not the interpolated name.
    expect(nonGsm7Chars(sms.sent[0]!.body, [res.customerName ?? ""])).toEqual([]);
  });

  it("carries the cancellation terms on both channels (#619)", async () => {
    const email = capturing();
    const sms = capturing();

    await sendBookingConfirmation(
      { email, sms, linkBase: BASE },
      reservation(),
      CODE,
    );

    // The SHORT form, quoted from the constant — the body goes out verbatim as SMS and the
    // long paragraph would cost a second segment on every confirmation.
    expect(email.sent[0]!.body).toContain(CANCELLATION_TERMS_SHORT);
    expect(sms.sent[0]!.body).toContain(CANCELLATION_TERMS_SHORT);
    expect(sms.sent[0]!.body.toLowerCase()).not.toContain("insurance"); // unsellable (#683)
  });

  it("email-only reservation ⇒ only the email side fires", async () => {
    const email = capturing();
    const sms = capturing();
    await sendBookingConfirmation(
      { email, sms, linkBase: BASE },
      reservation({ phone: null }),
      CODE,
    );
    expect(email.sent).toHaveLength(1);
    expect(sms.sent).toHaveLength(0);
  });

  it("phone-only reservation ⇒ only the SMS side fires", async () => {
    const email = capturing();
    const sms = capturing();
    await sendBookingConfirmation(
      { email, sms, linkBase: BASE },
      reservation({ email: null }),
      CODE,
    );
    expect(email.sent).toHaveLength(0);
    expect(sms.sent).toHaveLength(1);
  });

  it("a channel present but the contact field missing ⇒ that side is skipped", async () => {
    const sms = capturing();
    // email channel configured, but the reservation has no email.
    const email = capturing();
    await sendBookingConfirmation(
      { email, sms, linkBase: BASE },
      reservation({ email: null, phone: null }),
      CODE,
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
        { email, sms, linkBase: BASE, onFailure },
        reservation(),
        CODE,
      ),
    ).resolves.toBeUndefined(); // never throws — a paid booking must not 500 the webhook

    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure.mock.calls[0]![0]).toContain("email confirmation");
    expect(sms.sent).toHaveLength(1); // the SMS side still went out
  });
});
