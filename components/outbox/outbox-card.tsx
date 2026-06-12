import { answerOwnAsk, markSent, markUnsent } from "../../app/(admin)/admin/outbox/actions";

/**
 * One outbox card (DEC-030) — one ask the operator still owes a relay (or, for
 * an ask addressed to the operator themself, an inline answer). Server
 * component, no client JS: Send is a plain `sms:` anchor (opens the native
 * Messages app prefilled); mark-sent / not-sent / In / Out are form posts.
 *
 * A card is inline-OR-relayed, never both (`mode: "self"` replaces the relay
 * affordances entirely) — the same ask must not be answerable through two
 * doors at once.
 */

export interface OutboxCardVM {
  entryId: string;
  askId: string;
  crewName: string;
  /** "Sat, Jul 4 · Tidewater · captain" */
  factsLabel: string;
  /** "20h to trip" / "departed" — null when no scheduled event anchors it. */
  toTrip: string | null;
  /** Inside the shouting window — the countdown turns red. */
  tight: boolean;
  /** "2nd ask · Lance declined" */
  whyLabel: string;
  /** The prefilled `sms:` href — null when the crew member has no phone. */
  smsHref: string | null;
  mode: "relay" | "self" | "sent";
  /** "sent 2:14 PM" — sent cards only. */
  sentLabel: string | null;
}

export function OutboxCard({ card }: { card: OutboxCardVM }) {
  const muted = card.mode === "sent";
  return (
    <article
      className={`overflow-hidden rounded-card border border-line bg-card shadow-sm ${muted ? "opacity-60" : ""}`}
    >
      <div className="flex flex-col gap-1 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold text-ink">
            {card.crewName}
            {card.mode === "self" && (
              <span className="ml-2 rounded-full border border-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
                you
              </span>
            )}
          </span>
          {card.toTrip && (
            <span
              className={`shrink-0 font-mono text-sm font-semibold ${card.tight ? "text-bad" : "text-ink"}`}
            >
              {card.toTrip}
            </span>
          )}
        </div>
        <span className="text-sm text-muted">{card.factsLabel}</span>
        <span className="text-xs text-muted">{card.whyLabel}</span>
      </div>

      {card.mode === "relay" &&
        (card.smsHref ? (
          // Two taps by design: opening the composer isn't proof of send.
          <div className="grid grid-cols-[1fr_auto] gap-px border-t border-line bg-line">
            <a
              href={card.smsHref}
              className="flex min-h-[52px] items-center justify-center bg-ok font-semibold text-white"
            >
              Text {card.crewName} →
            </a>
            <form action={markSent} className="flex">
              <input type="hidden" name="entryId" value={card.entryId} />
              <button
                type="submit"
                className="min-h-[52px] bg-card px-4 text-sm font-medium text-accent"
              >
                Mark sent
              </button>
            </form>
          </div>
        ) : (
          <p className="border-t border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn">
            No phone on file for {card.crewName} — add one on the roster, then
            relay from here.
          </p>
        ))}

      {card.mode === "self" && (
        // The operator's own ask: answer it right here (admin session), exactly
        // the crew app's In/Out — one form, two submit buttons, no client JS.
        <form
          action={answerOwnAsk}
          className="grid grid-cols-2 gap-px border-t border-line bg-line"
        >
          <input type="hidden" name="askId" value={card.askId} />
          <button
            type="submit"
            name="response"
            value="declined"
            className="min-h-[52px] w-full bg-card font-semibold text-bad"
          >
            Out
          </button>
          <button
            type="submit"
            name="response"
            value="accepted"
            className="min-h-[52px] w-full bg-ok font-semibold text-white"
          >
            In
          </button>
        </form>
      )}

      {card.mode === "sent" && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2">
          <span className="text-xs text-muted">
            {card.sentLabel ?? "sent"} · awaiting reply
          </span>
          <form action={markUnsent}>
            <input type="hidden" name="entryId" value={card.entryId} />
            <button type="submit" className="text-xs font-medium text-accent">
              Not sent? Move back
            </button>
          </form>
        </div>
      )}
    </article>
  );
}
