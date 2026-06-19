import { answerOwnAsk } from "../../app/(admin)/admin/outbox/actions";
import { RelaySend } from "./relay-send";

/**
 * One outbox card (DEC-030) — one ask the operator still owes a relay (or, for
 * an ask addressed to the operator themself, an inline answer). The relay Send
 * is the single-click `RelaySend` island (the one `'use client'` exception,
 * DEC-026); the inline In/Out and the no-phone notice stay server-rendered.
 *
 * A card is inline-OR-relayed, never both (`mode: "self"` replaces the relay
 * affordances entirely) — the same ask must not be answerable through two
 * doors at once.
 */

export interface OutboxCardVM {
  entryId: string;
  askId: string;
  crewName: string;
  /** "Sat, Jul 4 · 3:00 PM · Tidewater · captain" (departure time when scheduled) */
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

      {card.mode !== "self" &&
        (card.smsHref ? (
          <RelaySend
            entryId={card.entryId}
            smsHref={card.smsHref}
            initialSent={card.mode === "sent"}
            initialSentLabel={card.sentLabel}
          />
        ) : card.mode === "sent" ? (
          <div className="border-t border-line px-4 py-2 text-xs text-muted">
            {card.sentLabel ?? "sent"} · awaiting reply
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
    </article>
  );
}
