/**
 * What the operator is told after the payment link goes out (issue #1082 part B) — at booking, and
 * on each Send payment link. Every channel is named: sent, failed, or not tried.
 */
import { describe, expect, it } from "vitest";
import { cancelNoticeMessage, paymentLinkSentMessage } from "./payment-link-message";

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

/**
 * What the operator reads under a cancel (issue #1212), from the `told` code. `logged`, and `absent`
 * with that contact on file, read as not told: the message reached a server log, or nowhere, and
 * the operator has to pick up the phone (DEC-170).
 */
describe("cancelNoticeMessage", () => {
  const both = { phone: "+12165550199", email: "rhea@example.com" };

  it("AC11: everything sent", () => {
    expect(cancelNoticeMessage("sent-sent", both)).toEqual({
      tone: "ok",
      text: "Customer told: texted to (216) 555-0199 and emailed to rhea@example.com.",
    });
  });

  it("AC11: the only contact on file was sent", () => {
    expect(cancelNoticeMessage("absent-sent", { phone: both.phone })).toEqual({
      tone: "ok",
      text: "Customer told: texted to (216) 555-0199.",
    });
    expect(cancelNoticeMessage("sent-absent", { email: both.email })).toEqual({
      tone: "ok",
      text: "Customer told: emailed to rhea@example.com.",
    });
  });

  it("AC11: one of two sent names the one that failed", () => {
    expect(cancelNoticeMessage("failed-sent", both)).toEqual({
      tone: "ok",
      text: "Customer told: texted to (216) 555-0199. The email to rhea@example.com failed.",
    });
  });

  it("AC11: one sent and the other only logged is ok, and says the other is not set up", () => {
    expect(cancelNoticeMessage("logged-sent", both)).toEqual({
      tone: "ok",
      text: "Customer told: texted to (216) 555-0199. No email channel is set up here for rhea@example.com.",
    });
  });

  it("AC11: a channel this deployment lacks reads as logged when the contact is on file", () => {
    expect(cancelNoticeMessage("absent-sent", both)).toEqual({
      tone: "ok",
      text: "Customer told: texted to (216) 555-0199. No email channel is set up here for rhea@example.com.",
    });
  });

  it("AC11: none sent, one failed", () => {
    expect(cancelNoticeMessage("absent-failed", { phone: both.phone })).toEqual({
      tone: "bad",
      text: "The customer was NOT told: the text to (216) 555-0199 failed. Call them.",
    });
  });

  it("AC11: none sent, both failed, joined with a semicolon", () => {
    expect(cancelNoticeMessage("failed-failed", both)).toEqual({
      tone: "bad",
      text: "The customer was NOT told: the text to (216) 555-0199 failed; the email to rhea@example.com failed. Call them.",
    });
  });

  it("AC11: none sent, a channel not set up", () => {
    expect(cancelNoticeMessage("logged-absent", { email: both.email })).toEqual({
      tone: "bad",
      text: "The customer was NOT told: no email channel is set up here for rhea@example.com. Call them.",
    });
  });

  it("AC11: none sent, absent with the contact on file reads the same as logged", () => {
    expect(cancelNoticeMessage("absent-absent", { email: both.email })).toEqual({
      tone: "bad",
      text: "The customer was NOT told: no email channel is set up here for rhea@example.com. Call them.",
    });
  });

  it("AC11: skipped", () => {
    expect(cancelNoticeMessage("skipped", both)).toEqual({
      tone: "bad",
      text: "The customer was NOT told — no text or email is set up on this deployment. Call them.",
    });
  });

  it("AC11: skipped wins over no contact on file", () => {
    expect(cancelNoticeMessage("skipped", {})).toEqual({
      tone: "bad",
      text: "The customer was NOT told — no text or email is set up on this deployment. Call them.",
    });
  });

  it("AC11: error", () => {
    expect(cancelNoticeMessage("error", both)).toEqual({
      tone: "bad",
      text: "The customer was NOT told — the message never went out. Call them.",
    });
  });

  it("AC11: no contact on file", () => {
    expect(cancelNoticeMessage("absent-absent", {})).toEqual({
      tone: "bad",
      text: "The customer was NOT told — there is no phone or email on this booking.",
    });
  });
});
