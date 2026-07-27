import {
  answerOwnAsk,
  dismissOutboxEntry,
  recordSent,
} from "../../app/(admin)/admin/outbox/actions";
import { CopyButton } from "../ui/copy-button";
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
  /** "2nd ask · Lance declined" */
  whyLabel: string;
  /** The prefilled `sms:` href — null when the crew member has no phone. */
  smsHref: string | null;
  /** The full relay message (body + magic link) — copy-pasteable + the Web Share text (#160). */
  shareText: string;
  /** The crew member's number for the relay (Google Voice lookup / copy) — "" when none. */
  crewPhone: string;
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
              className="shrink-0 font-mono text-sm font-semibold text-ink"
            >
              {card.toTrip}
            </span>
          )}
        </div>
        <span className="text-sm text-muted">{card.factsLabel}</span>
        <span className="text-xs text-muted">{card.whyLabel}</span>
      </div>

      {card.mode !== "self" && (
        <>
          {/* Relay details (#160): the full message to copy-paste + the recipient's
              name/number, so the operator can send from Google Voice (manual
              conversation pick) or any channel — the cross-platform baseline. The
              text is `select-all` so a blocked clipboard still copies by hand. */}
          <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              {/* min-w-0 so the long magic-link URL WRAPS instead of forcing the row
                  wider than the card and shoving the Copy button off-screen. */}
              <p className="min-w-0 select-all whitespace-pre-wrap break-words text-sm text-ink">
                {card.shareText}
              </p>
              <CopyButton value={card.shareText} label="Copy" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="select-all text-sm text-muted">
                {card.crewName} · {card.crewPhone || "no phone on file"}
              </span>
              {card.crewPhone && (
                <CopyButton value={card.crewPhone} label="Copy #" />
              )}
            </div>
          </div>
          {card.mode === "relay" ? (
            // Pending: Dismiss | Send as a two-button row — the In/Out idiom
            // (white-red Dismiss | green-white Send). Send is Web Share (Google
            // Voice) → sms: fallback; works even with no phone (share has no
            // recipient field). Both buttons carry the top border so the row reads
            // as one bar with a center divider (gap-px bg-line).
            <div className="grid grid-cols-2 gap-px bg-line">
              <form action={dismissOutboxEntry}>
                <input type="hidden" name="entryId" value={card.entryId} />
                <button
                  type="submit"
                  className="min-h-[52px] w-full border-t border-line bg-card font-semibold text-bad"
                >
                  Dismiss
                </button>
              </form>
              <RelaySend
                entryId={card.entryId}
                shareText={card.shareText}
                smsHref={card.smsHref}
                initialSent={false}
                initialSentLabel={null}
                onRecord={recordSent}
                compact
              />
            </div>
          ) : (
            // Sent: the muted awaiting-reply state (Resend) above a low-emphasis
            // Dismiss — the card is already opacity-60, so this stays quiet.
            <>
              <RelaySend
                entryId={card.entryId}
                shareText={card.shareText}
                smsHref={card.smsHref}
                initialSent
                initialSentLabel={card.sentLabel}
                onRecord={recordSent}
              />
              <form action={dismissOutboxEntry} className="border-t border-line">
                <input type="hidden" name="entryId" value={card.entryId} />
                <button
                  type="submit"
                  className="w-full px-4 py-2 text-xs text-muted hover:text-bad"
                >
                  Dismiss — clear from your list (the ask still times out on its own)
                </button>
              </form>
            </>
          )}
        </>
      )}

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
