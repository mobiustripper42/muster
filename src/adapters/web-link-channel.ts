/**
 * Web-link pilot channel adapter (DEC-030, DEC-MSG-3 adapter #2).
 *
 * The pilot transport is the OPERATOR: `send` does not transmit anything — it
 * enqueues an `OutboxEntry` the operator works from the outbox page, where each
 * pending ask is an `sms:` deep link that opens their native Messages app
 * pre-filled (recipient + ask body + magic link). The crew member taps the
 * link, lands authenticated on the In/Out screen, and answers through
 * `recordResponseAndConfirm` (a winning "in" auto-confirms, DEC-061) — no inbound
 * webhook, no Twilio.
 *
 * Two load-bearing rules (DEC-030):
 *  - **Mint at enqueue.** The magic link (24h TTL — the ask's answer window;
 *    the 15-min dev-link TTL stays dev-only) is minted HERE, once, and frozen
 *    onto the entry. A page refresh re-renders the stored text verbatim and can
 *    never desync from what the operator already texted.
 *  - **`deliveredAt` = enqueue time.** The channel accepted the message when it
 *    queued it; the operator's physical text is `OutboxEntry.sentAt`, a
 *    channel-side fact the domain never reads.
 *
 * Outbox state is adapter-side, persisted via the Repository port (the
 * `MagicToken` precedent) — the domain `Ask` is unchanged, which is what keeps
 * the eventual Twilio swap a zero-domain-change drop-in (DEC-MSG-1).
 *
 * Clockless/deterministic like the rest of the core: `now` and `mintSecret`
 * are injectable; production defaults are the wall clock + crypto-random.
 */

import type { OutboxEntry } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import {
  type ChannelPort,
  type OutboundMessage,
  requireCrewId,
  type SendResult,
} from "../ports/channel.js";
import type { Repository } from "../ports/repository.js";
import { issueMagicLink, randomSecret } from "../auth/magic-link.js";

/** Relay links live as long as the ask's answer window — 24h (DEC-030). */
export const RELAY_LINK_TTL_MS = 24 * 60 * 60 * 1000;

export interface WebLinkChannelOptions {
  /**
   * The externally-reachable origin links are built on (no trailing slash),
   * e.g. `https://app.example.com`. Delivered links MUST come from a trusted
   * config value in production (see app/lib/base-url.ts on host-header
   * poisoning) — the adapter just takes what it's given.
   */
  linkBase: string;
  /** Injected clock — defaults to the wall clock for app/dev use. */
  now?: () => Date;
  /** Injected secret generator — defaults to crypto-random. */
  mintSecret?: () => string;
}

export class WebLinkChannel implements ChannelPort {
  readonly #repo: Repository;
  readonly #linkBase: string;
  readonly #now: () => Date;
  readonly #mintSecret: () => string;

  constructor(repo: Repository, options: WebLinkChannelOptions) {
    this.#repo = repo;
    this.#linkBase = options.linkBase.replace(/\/+$/, "");
    this.#now = options.now ?? (() => new Date());
    this.#mintSecret = options.mintSecret ?? randomSecret;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    // The pilot relays ASKS — the correlation ids are what let the outbox card
    // derive its "why" line and the answer flow find its seat. A message
    // without them is a mis-wire, and `send` may throw when the medium
    // rejects a message (port contract).
    if (!message.askId || !message.seatId) {
      throw new Error("web-link channel relays asks: askId + seatId required");
    }

    const now = this.#now();
    const crewMemberId = requireCrewId(message.to);
    // Minted at enqueue, stored verbatim (DEC-030): the link in the entry IS
    // the link that gets texted, forever.
    const { secret } = await issueMagicLink(
      this.#repo,
      {
        subjectKind: "crew",
        subjectId: crewMemberId,
        ttlMs: RELAY_LINK_TTL_MS,
      },
      { now, mintSecret: this.#mintSecret },
    );

    const entry: OutboxEntry = {
      // One entry per ask, deterministic (codebase convention) — a re-send of
      // the same ask upserts rather than duplicating the operator's worklist.
      id: asId<"OutboxEntryId">(`obx-${message.askId}`),
      askId: message.askId,
      seatId: message.seatId,
      crewMemberId,
      body: message.body,
      link: `${this.#linkBase}/crew/auth?t=${secret}`,
      status: "pending",
      createdAt: now.toISOString(),
    };
    await this.#repo.saveOutboxEntry(entry);

    return { deliveredAt: entry.createdAt, ref: entry.id };
  }
}
