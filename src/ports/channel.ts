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
 *   2. Pilot adapter — the first real crew test, operator picks the medium later:
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

/** Why a message is going out — lets an adapter format per purpose if it wants. */
export type MessageKind = "ask" | "magic_link" | "receipt";

/**
 * How to reach the recipient. The adapter chooses what it needs (an SMS adapter
 * reads `phone`; an email/dev-stub reads `email`; a web-link adapter may key off
 * `crewMemberId`). Crew records are operator-created (DEC-010), so the engine
 * always knows the `crewMemberId`; contact fields are best-effort hints.
 */
export interface Recipient {
  crewMemberId: CrewMemberId;
  phone?: string;
  email?: string;
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
}

export interface ChannelPort {
  /** Hand one message to the delivery medium. Throws if the medium rejects it. */
  send(message: OutboundMessage): Promise<SendResult>;
}
