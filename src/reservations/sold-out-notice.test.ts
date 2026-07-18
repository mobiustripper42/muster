/**
 * Sold-out notice emit (12.1b, DEC-109 residual race) — best-effort email + SMS.
 */
import { describe, expect, it } from "vitest";
import type { ChannelPort, OutboundMessage, SendResult } from "../ports/channel.js";
import { sendSoldOutNotice, soldOutNoticeBody } from "./sold-out-notice.js";

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

describe("soldOutNoticeBody", () => {
  it("names the customer and states plainly they were NOT charged / fully refunded", () => {
    const body = soldOutNoticeBody("Mary");
    expect(body).toContain("Mary");
    expect(body).toContain("sold out");
    expect(body.toLowerCase()).toContain("refund");
    expect(body).toContain("NOT been charged");
  });
  it("falls back to 'there' when the name is blank", () => {
    expect(soldOutNoticeBody("  ")).toContain("Hi there,");
  });
});

describe("sendSoldOutNotice", () => {
  const contact = { customerName: "Mary", email: "mary@example.com", phone: "+15550001111" };

  it("sends on both channels when both contact + channel are present", async () => {
    const email = capturing();
    const sms = capturing();
    await sendSoldOutNotice({ email, sms }, contact);
    expect(email.sent).toHaveLength(1);
    expect(sms.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toEqual({ email: "mary@example.com" });
    expect(sms.sent[0]!.to).toEqual({ phone: "+15550001111" });
    expect(email.sent[0]!.body).toContain("refund");
  });

  it("email-only contact → no SMS attempted", async () => {
    const email = capturing();
    const sms = capturing();
    await sendSoldOutNotice({ email, sms }, { customerName: "Mary", email: "m@x.io" });
    expect(email.sent).toHaveLength(1);
    expect(sms.sent).toHaveLength(0);
  });

  it("missing both contact and channel → no-op", async () => {
    await expect(sendSoldOutNotice({}, { customerName: "Mary" })).resolves.toBeUndefined();
  });

  it("best-effort: a throwing channel is swallowed and surfaced via onFailure, never rethrown", async () => {
    const failures: string[] = [];
    const email = capturing(true); // throws
    const sms = capturing();
    await expect(
      sendSoldOutNotice({ email, sms, onFailure: (d) => failures.push(d) }, contact),
    ).resolves.toBeUndefined();
    expect(sms.sent).toHaveLength(1); // the SMS side still fired independently
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("sold-out email");
  });
});
