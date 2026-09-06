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
 *    The crew-link adapters feed it straight into `issueMagicLink`; keeping it
 *    required is what stops a builder silently emitting a link with no subject.
 *  - `GuestRecipient` — a booking customer (DEC-122) is not a crew member: email
 *    and/or phone, no `crewMemberId`. Only the guest-safe `receipt` send path
 *    (composed body, no minted crew link) ever addresses one.
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
}

/**
 * How long a relayed magic link lives: the ask's answer window (DEC-030). The 15-minute
 * dev-link TTL stays dev-only.
 *
 * Lived in `web-link-channel.ts` until #934 deleted that adapter, and `TwilioChannel`
 * imported it from there — an adapter depending on a sibling adapter for a contract
 * constant. It belongs with the port both of them implement.
 */
export const RELAY_LINK_TTL_MS = 24 * 60 * 60 * 1000;

export interface ChannelPort {
  /** Hand one message to the delivery medium. Throws if the medium rejects it. */
  send(message: OutboundMessage): Promise<SendResult>;
}
