import { recordNoticeSent } from "../../app/(admin)/admin/outbox/actions";
import { CopyButton } from "../ui/copy-button";
import { RelaySend } from "./relay-send";

/**
 * One assignment-change relay card (DEC-084) — the "Assignment changes" sibling to
 * the ask {@link OutboxCard} and the ring {@link RingOutboxCard}. Always relay (the
 * operator is excluded, DEC-072/084 — no inline `self` mode) and carries no
 * trip/why. Reuses the one hardened `RelaySend` island, passing `recordNoticeSent`.
 */

export interface NoticeOutboxCardVM {
  entryId: string;
  crewName: string;
  /** The frozen relay text ("you're off the Sat, Jul 4 · Barrel shift."). */
  body: string;
  /** The full relay message (body + frozen /crew link) for the Web Share sheet — no recipient. */
  shareText: string;
  /** Prefilled `sms:` href — null when the crew member has no phone. */
  smsHref: string | null;
  initialSent: boolean;
  /** "sent 2:14 PM" — sent cards only. */
  sentLabel: string | null;
}

export function NoticeOutboxCard({ card }: { card: NoticeOutboxCardVM }) {
  return (
    <article
      className={`overflow-hidden rounded-card border border-line bg-card shadow-sm ${card.initialSent ? "opacity-60" : ""}`}
    >
      <div className="flex flex-col gap-1 px-4 py-3">
        <span className="font-semibold text-ink">{card.crewName}</span>
        <span className="text-sm text-muted">{card.body}</span>
      </div>

      {/* The full relay message to copy-paste (#186) — mirrors the ask/ring cards so
          RelaySend's "copy the message above" fallback is true here too. */}
      <div className="flex items-start justify-between gap-2 border-t border-line px-4 py-3">
        <p className="min-w-0 select-all whitespace-pre-wrap break-words text-sm text-ink">
          {card.shareText}
        </p>
        <CopyButton value={card.shareText} label="Copy" />
      </div>

      {/* Always render RelaySend (mirroring the ask/ring cards): a no-phone crew
          member is still relayable via Web Share. RelaySend owns the no-channel copy. */}
      <RelaySend
        entryId={card.entryId}
        shareText={card.shareText}
        smsHref={card.smsHref}
        initialSent={card.initialSent}
        initialSentLabel={card.sentLabel}
        onRecord={recordNoticeSent}
      />
    </article>
  );
}
