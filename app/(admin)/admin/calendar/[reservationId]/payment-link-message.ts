import { formatPhoneForDisplay, type CanonicalPhone } from "@core/customers/identity.js";

/**
 * The line the operator reads after a payment link goes out (issue #1082 part B).
 *
 * `value` is the action's redirect code: `<email>-<sms>` per channel (`sent` | `failed` | `logged`
 * | `absent`, as the booking link's resend), `skipped` when the deployment has no live channel at
 * all, `not_payable` when the booking was paid or cancelled first, or `error` when the send never
 * ran. Codes on the query string, prose here (DEC-147).
 *
 * `logged` reads as "not sent": the message reached a server log, not the customer (#955).
 */
export function paymentLinkSentMessage(
  value: string,
  contact: { phone?: string | undefined; email?: string | undefined },
): { tone: "ok" | "bad"; text: string } {
  const retry = "Send it again, or copy it and send it yourself.";
  if (value === "error") return { tone: "bad", text: `Couldn’t send the payment link just now. ${retry}` };
  // Paid or cancelled between the render and the press.
  if (value === "not_payable") {
    return { tone: "bad", text: "This booking isn’t awaiting payment any more, so no link was sent. Reload to see it." };
  }
  if (value === "skipped") {
    return {
      tone: "bad",
      text: "The payment link wasn’t sent — no text or email is set up on this deployment. Copy it and send it yourself.",
    };
  }

  const { sent, notSent } = channelOutcomeLists(value, contact);

  if (sent.length === 0) {
    return { tone: "bad", text: `The payment link wasn’t sent: ${notSent.join("; ") || "nowhere to send it"}. ${retry}` };
  }
  const head = `Payment link ${sent.join(" and ")}.`;
  const tail = notSent.map((s) => `${s[0]!.toUpperCase()}${s.slice(1)}.`).join(" ");
  return { tone: "ok", text: tail ? `${head} ${tail}` : head };
}

/**
 * The per-channel lists behind both messages: what went (`texted to …`, `emailed to …`) and what did
 * not (`the text to … failed`, `no email channel is set up here for …`), text before email. A channel
 * with no contact on file is in neither list. Lifted out of `paymentLinkSentMessage` unchanged.
 */
export function channelOutcomeLists(
  value: string,
  contact: { phone?: string | undefined; email?: string | undefined },
): { sent: string[]; notSent: string[] } {
  const [emailState, smsState] = value.split("-");
  const phone = contact.phone ? formatPhoneForDisplay(contact.phone as CanonicalPhone) : undefined;
  const email = contact.email;

  const sent = [
    smsState === "sent" && phone ? `texted to ${phone}` : "",
    emailState === "sent" && email ? `emailed to ${email}` : "",
  ].filter(Boolean);
  const notSent = [
    smsState === "failed" && phone ? `the text to ${phone} failed` : "",
    smsState === "logged" && phone ? `no text channel is set up here for ${phone}` : "",
    emailState === "failed" && email ? `the email to ${email} failed` : "",
    emailState === "logged" && email ? `no email channel is set up here for ${email}` : "",
  ].filter(Boolean);
  return { sent, notSent };
}

/**
 * The line the operator reads after a cancel (issue #1212), from the `told` code the redirect
 * carries: `<email>-<sms>` per channel, `skipped` when the deployment has no live channel, `error`
 * when the send never ran. Codes on the query string, prose here (DEC-147).
 *
 * `logged` is not told, as for the payment link (DEC-170). So is `absent` with that contact on
 * file, which `tryChannel` also reports for a channel this deployment lacks; it reads as `logged`.
 */
export function cancelNoticeMessage(
  value: string,
  contact: { phone?: string | undefined; email?: string | undefined },
): { tone: "ok" | "bad"; text: string } {
  // `skipped` before no-contact, as `deliverPaymentLink` orders them.
  if (value === "skipped") {
    return { tone: "bad", text: "The customer was NOT told — no text or email is set up on this deployment. Call them." };
  }
  if (value === "error") {
    return { tone: "bad", text: "The customer was NOT told — the message never went out. Call them." };
  }

  const [emailState, smsState] = value.split("-");
  const lacked = (state: string | undefined, onFile: string | undefined) =>
    state === "absent" && onFile ? "logged" : state;
  const { sent, notSent } = channelOutcomeLists(
    `${lacked(emailState, contact.email)}-${lacked(smsState, contact.phone)}`,
    contact,
  );

  if (sent.length === 0) {
    if (notSent.length === 0) {
      return { tone: "bad", text: "The customer was NOT told — there is no phone or email on this booking." };
    }
    return { tone: "bad", text: `The customer was NOT told: ${notSent.join("; ")}. Call them.` };
  }
  const head = `Customer told: ${sent.join(" and ")}.`;
  const tail = notSent.map((s) => `${s[0]!.toUpperCase()}${s.slice(1)}.`).join(" ");
  return { tone: "ok", text: tail ? `${head} ${tail}` : head };
}
