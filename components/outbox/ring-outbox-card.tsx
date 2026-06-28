import { recordRingSent } from "../../app/(admin)/admin/outbox/actions";
import { RelaySend } from "./relay-send";

/**
 * One doorbell-ring relay card (#118, DEC-073) — the "New messages" sibling to the
 * ask {@link OutboxCard}. Simpler by design: a ring is ALWAYS relay (the operator is
 * excluded from rings, DEC-072 — no inline `self` mode) and carries no trip/why. The
 * relay Send reuses the one hardened `RelaySend` island, passing `recordRingSent`.
 */

export interface RingOutboxCardVM {
  entryId: string;
  crewName: string;
  /** The frozen relay text — "2 new messages" / the inlined short note. */
  body: string;
  /** The full relay message (body + frozen deep-link) for the Web Share sheet (#160) — no recipient. */
  shareText: string;
  /** Prefilled `sms:` href — null when the crew member has no phone. */
  smsHref: string | null;
  initialSent: boolean;
  /** "sent 2:14 PM" — sent cards only. */
  sentLabel: string | null;
}

export function RingOutboxCard({ card }: { card: RingOutboxCardVM }) {
  return (
    <article
      className={`overflow-hidden rounded-card border border-line bg-card shadow-sm ${card.initialSent ? "opacity-60" : ""}`}
    >
      <div className="flex flex-col gap-1 px-4 py-3">
        <span className="font-semibold text-ink">{card.crewName}</span>
        <span className="text-sm text-muted">{card.body}</span>
      </div>

      {card.smsHref ? (
        <RelaySend
          entryId={card.entryId}
          shareText={card.shareText}
          smsHref={card.smsHref}
          initialSent={card.initialSent}
          initialSentLabel={card.sentLabel}
          onRecord={recordRingSent}
        />
      ) : card.initialSent ? (
        <div className="border-t border-line px-4 py-2 text-xs text-muted">
          {card.sentLabel ?? "sent"} · awaiting read
        </div>
      ) : (
        <p className="border-t border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn">
          No phone on file for {card.crewName} — add one on the roster, then relay
          from here.
        </p>
      )}
    </article>
  );
}
