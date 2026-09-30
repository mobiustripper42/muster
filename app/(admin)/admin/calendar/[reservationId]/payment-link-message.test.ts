/**
 * What the operator is told after the payment link goes out (issue #1082 part B) — at booking, and
 * on each Send payment link. Every channel is named: sent, failed, or not tried.
 */
import { describe, expect, it } from "vitest";
import { paymentLinkSentMessage } from "./payment-link-message";

const contact = { phone: "+12165550199", email: "caller@example.com" };

describe("paymentLinkSentMessage", () => {
  it("both went", () => {
    expect(paymentLinkSentMessage("sent-sent", contact)).toEqual({
      tone: "ok",
      text: "Payment link texted to (216) 555-0199 and emailed to caller@example.com.",
    });
  });

  it("text only, on a booking with no email", () => {
    expect(paymentLinkSentMessage("absent-sent", { phone: contact.phone })).toEqual({
      tone: "ok",
      text: "Payment link texted to (216) 555-0199.",
    });
  });

  it("a failed channel is named beside the one that went", () => {
    expect(paymentLinkSentMessage("failed-sent", contact)).toEqual({
      tone: "ok",
      text: "Payment link texted to (216) 555-0199. The email to caller@example.com failed.",
    });
  });

  it("nothing went: says which failed or wasn't tried, and what to do", () => {
    expect(paymentLinkSentMessage("absent-failed", { phone: contact.phone })).toEqual({
      tone: "bad",
      text: "The payment link wasn’t sent: the text to (216) 555-0199 failed. Send it again, or copy it and send it yourself.",
    });
    expect(paymentLinkSentMessage("absent-logged", { phone: contact.phone })).toEqual({
      tone: "bad",
      text: "The payment link wasn’t sent: no text channel is set up here for (216) 555-0199. Send it again, or copy it and send it yourself.",
    });
  });

  it("paid or cancelled since the pane was drawn: nothing sent, and says why", () => {
    expect(paymentLinkSentMessage("not_payable", contact)).toEqual({
      tone: "bad",
      text: "This booking isn’t awaiting payment any more, so no link was sent. Reload to see it.",
    });
  });

  it("no channel at all, or an error before any send", () => {
    expect(paymentLinkSentMessage("skipped", contact).tone).toBe("bad");
    expect(paymentLinkSentMessage("skipped", contact).text).toContain("no text or email is set up");
    expect(paymentLinkSentMessage("error", contact)).toEqual({
      tone: "bad",
      text: "Couldn’t send the payment link just now. Send it again, or copy it and send it yourself.",
    });
  });
});
