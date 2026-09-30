/**
 * Sending the payment link (issue #1082 part B) — texted and emailed to the contact on file, with
 * each channel reported on its own so a failed one is named on the operator's screen, never
 * swallowed into a green "sent".
 */
import { describe, expect, it } from "vitest";
import type { Reservation } from "../domain/entities.js";
import type { ChannelPort, OutboundMessage } from "../ports/channel.js";
import { paymentLinkBody, sendPaymentLink } from "./send-payment-link.js";
import { nonGsm7Chars } from "./sms-alphabet.js";

const URL = "https://muster.example/p/ASNFZ4mrze8BI0VniavN7w.tzq8xy.Qf5LdfzEPc-7QD1VqiMPmo";

function reservation(over: Record<string, unknown> = {}): Reservation {
  return {
    id: "resv-0123",
    customerName: "Phone Caller",
    phone: "+12165550199",
    email: "caller@example.com",
    date: "2026-10-21",
    time: "15:30",
    ...over,
  } as unknown as Reservation;
}

function channel(opts: { throws?: boolean; logs?: boolean } = {}): ChannelPort & { sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = [];
  return {
    sent,
    async send(msg: OutboundMessage) {
      if (opts.throws) throw new Error("medium rejected it");
      sent.push(msg);
      return opts.logs
        ? { deliveredAt: "2026-10-01T00:00:00.000Z", ref: "logged", loggedOnly: true }
        : { deliveredAt: "2026-10-01T00:00:00.000Z" };
    },
  } as ChannelPort & { sent: OutboundMessage[] };
}

describe("paymentLinkBody", () => {
  it("names the trip, carries the link and says how long it works — in plain GSM-7", () => {
    const body = paymentLinkBody(reservation(), URL, "BrewBoat");
    expect(body).toContain("Hi Phone, here is the link to pay for your BrewBoat trip");
    expect(body).toContain("Wed, Oct 21 at 3:30 PM");
    expect(body).toContain(URL);
    expect(body).toContain("The link works for 72 hours.");
    expect(nonGsm7Chars(body, [URL])).toEqual([]);
  });
});

describe("sendPaymentLink", () => {
  it("texts the mobile and emails the address, and says so per channel", async () => {
    const email = channel();
    const sms = channel();
    const r = await sendPaymentLink({ tenantName: "BrewBoat", email, sms }, reservation(), URL);
    expect(r).toEqual({ email: "sent", sms: "sent" });
    expect(sms.sent[0]).toMatchObject({ to: { phone: "+12165550199" } });
    expect(email.sent[0]).toMatchObject({ to: { email: "caller@example.com" } });
    expect(sms.sent[0]!.body).toContain(URL);
  });

  it("a failed channel is reported failed, and the other still goes", async () => {
    const failures: string[] = [];
    const r = await sendPaymentLink(
      { tenantName: "BrewBoat", email: channel({ throws: true }), sms: channel(), onFailure: (d) => failures.push(d) },
      reservation(),
      URL,
    );
    expect(r).toEqual({ email: "failed", sms: "sent" });
    expect(failures[0]).toContain("payment link");
  });

  it("no email on the booking is `absent`; a channel that only logs is `logged`, not sent", async () => {
    const r = await sendPaymentLink(
      { tenantName: "BrewBoat", email: channel(), sms: channel({ logs: true }) },
      reservation({ email: undefined }),
      URL,
    );
    expect(r).toEqual({ email: "absent", sms: "logged" });
  });
});
