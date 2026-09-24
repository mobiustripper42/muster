/**
 * The channel port (DEC-MSG-3, DEC-020).
 *
 * One port, many adapters. Everything the engine sends a crew member — the ask,
 * a magic link, a receipt — leaves through `send`. The engine never knows or
 * cares HOW it's delivered: that's the adapter's job, and adapters are swappable
 * without touching domain logic.
 *
 * Build order (DEC-MSG-3):
 *   1. Fake / log adapter — permanent test infra (src/adapters/fake-channel.ts).
 *   2. Operator-relayed adapter — the first real crew test, operator picks the medium:
 *      **web-link** (a link delivered manually) OR **Telegram** (inline buttons).
 *      Both are just `ChannelPort` implementations; the seam is this interface, so
 *      neither is hardcoded — the pick is a deploy-time wiring choice, not a code
 *      change here (DEC-MSG-3 keeps it deferrable).
 *   3. Twilio/SMS — the eventual production swap (DEC-MSG-1), same interface.
 *
 * Replies are NOT modeled here. An inbound "yes/no" re-enters the domain through
 * the ask loop's `recordResponseAndConfirm` (asks/ask-loop.ts) — the adapter's
 * inbound webhook/endpoint calls it, NOT raw `recordResponse` (which would strand
 * a winning "in" at `Claimed`; DEC-061 auto-confirms). The port is outbound-only
 * by design: delivery is the swappable part; the claim/response state machine
 * stays domain logic (REQ-CLAIM-1).
 */

import type { AskId, CrewMemberId, SeatId } from "../domain/ids.js";

/** Why a message is going out — lets an adapter format per purpose if it wants.
 *  `admin_alert` (DEC-095) is engine→operator, not a crew relay: a plain body +
 *  static board link, no minted crew link — rides the adapter's generic branch.
 *  `booking_request` (12.6) is customer→operator: a manage-page cancel/change request,
 *  emailed to the operator inbox — also plain body, generic branch, never a crew relay. */
export type MessageKind = "ask" | "magic_link" | "receipt" | "admin_alert" | "booking_request";

/**
 * How to reach the recipient. The adapter chooses what it needs (an SMS adapter
 * reads `phone`; an email/dev-stub reads `email`; a web-link adapter keys off
 * `crewMemberId` to mint a sign-in link).
 *
 * A discriminated union, NOT one shape with an optional `crewMemberId` (DEC-122):
 *  - `CrewRecipient` — the engine ALWAYS knows the crew member (records are
 *    operator-created, DEC-010), so a crew relay carries a required `crewMemberId`.
 *    Keeping it required is what stops a builder silently addressing a crew
 *    relay to no one.
 *  - `GuestRecipient` — a booking customer (DEC-122) is not a crew member: email
 *    and/or phone, no `crewMemberId`. Only the guest-safe `receipt` send path
 *    (composed body, no crew link) ever addresses one.
 */
export interface CrewRecipient {
  crewMemberId: CrewMemberId;
  phone?: string;
  email?: string;
}
export interface GuestRecipient {
  crewMemberId?: undefined;
  phone?: string;
  email?: string;
}
export type Recipient = CrewRecipient | GuestRecipient;

/**
 * Narrow a recipient to its crew `crewMemberId` for a crew-relay send (the ask,
 * a magic link, a notice/ring). Throws — LOUD, never a silent `undefined` into a
 * minted link — if handed a guest recipient, which by construction never reaches
 * a crew branch (DEC-122). Turns the union's `CrewMemberId | undefined` back into
 * the `CrewMemberId` the crew adapters require.
 */
export function requireCrewId(to: Recipient): CrewMemberId {
  if (to.crewMemberId === undefined) {
    throw new Error("crew relay requires a crewMemberId recipient (DEC-122)");
  }
  return to.crewMemberId;
}

/** One outbound message. `link` carries a magic link or the ask's tap-in URL. */
export interface OutboundMessage {
  to: Recipient;
  kind: MessageKind;
  body: string;
  link?: string;
  /** Correlation back to domain state, so a reply can be matched to its ask. */
  seatId?: SeatId;
  askId?: AskId;
}

/** What a send produced — enough to log/audit; adapters may add nothing else. */
export interface SendResult {
  /** ISO-8601 UTC stamp of when the adapter accepted the message for delivery. */
  deliveredAt: string;
  /** Adapter-specific handle (provider message id, log index, …) if any. */
  ref?: string;
  /**
   * **The message was written down, not transmitted (#955).** Set by `LogChannel` and by nothing
   * else — omitted means it actually left the building.
   *
   * It exists because #955 made every send site fall back to a channel that always accepts, which
   * turned "did not throw" into a useless proxy for "delivered". A caller that reports an outcome
   * to a person has to be able to tell the two apart, and the adapter is the only thing that
   * knows. Carrying it on the receipt rather than threading a flag down from the edge is what
   * stops a future caller forgetting to pass it.
   */
  loggedOnly?: true;
}

export interface ChannelPort {
  /** Hand one message to the delivery medium. Throws if the medium rejects it. */
  send(message: OutboundMessage): Promise<SendResult>;
}

/**
 * A delivery medium rejected the send, with the HTTP status it rejected it with (#902).
 *
 * The status is a **property**, not only a substring of the message, and that is the
 * whole reason this type exists. The relays that catch this error log it, and they
 * deliberately do not log the error's message: a provider's error body may quote back
 * what was sent, and what was sent is a crew member's 6-digit sign-in code or — until
 * issue #1030 retires ask links — a live magic link. Credentials do not go in logs,
 * whether or not a given provider happens to echo.
 *
 * The status carries none of that and is the half worth having: `422` says somebody
 * misconfigured a sender, `429` says we are being rate-limited, `503` says wait. A bare
 * "Error" says none of them, and that was the cost of the first cut of this narrowing.
 *
 * The message still carries the provider's detail, because a caller that HANDLES this
 * error rather than logging it wants the reason, and `email-channel.test.ts` pins it.
 */
export class ChannelSendError extends Error {
  readonly status: number;

  constructor(medium: string, status: number, detail: string) {
    super(`${medium} send failed (${status}): ${detail}`);
    this.name = "ChannelSendError";
    this.status = status;
  }
}

/**
 * What a relay may safely log about a failed send (#902).
 *
 * The relays are best-effort: a dead number cannot mute the rest, so they catch and
 * carry on. Since #902 they also log — and the one thing they must not log is the
 * error's message, for the reason on `ChannelSendError` above.
 *
 * So this is the redaction, in one place rather than repeated at six catch sites where
 * the next one would be written slightly differently and nobody would notice. Same
 * lesson as the helper this whole task exists to consolidate.
 *
 * A non-`ChannelSendError` gets its type name only. That is deliberate rather than
 * lazy: an unexpected error type from inside a channel adapter is exactly the case
 * where nobody has reasoned about what its message contains.
 */
export function describeSendFailure(e: unknown): string {
  if (e instanceof ChannelSendError) return `${e.name} (status ${e.status})`;
  if (e instanceof Error) return e.name;
  return "unknown error type";
}
