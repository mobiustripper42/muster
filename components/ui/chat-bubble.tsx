import type { ReactNode } from "react";

/**
 * One message in a thread (issue #484, gap audit part B) — the office's thread page and the crew's
 * draw the same bubble, and did it by hand twice. Yours sits right in the accent colour; theirs
 * sits left, white with an edge. No shadow: a bubble is read, not lifted off the page like a card,
 * which is why this file is exempt from `muster/surface` the way `card.tsx` is.
 *
 * `sender` is the caller's: the office reads "You (office)", crew read "You".
 */
export function ChatBubble({
  mine,
  sender,
  priority,
  at,
  children,
}: {
  mine: boolean;
  sender: string;
  priority: boolean;
  at: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex max-w-[85%] flex-col gap-0.5 rounded-box border px-3 py-2 ${
        mine
          // eslint-disable-next-line muster/button-kind -- a chat message bubble, not an action button (#1103)
          ? "self-end border-accent bg-accent text-white"
          : "self-start border-line bg-card text-ink"
      }`}
    >
      <span className={`flex items-center gap-2 text-[11px] ${mine ? "text-white/80" : "text-muted"}`}>
        <span className="font-semibold">{sender}</span>
        {priority && <span className="font-semibold uppercase tracking-wide">· Priority</span>}
        <span>· {at}</span>
      </span>
      <span className="whitespace-pre-wrap break-words text-sm">{children}</span>
    </div>
  );
}
