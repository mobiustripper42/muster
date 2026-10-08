import type { HTMLAttributes, ReactNode } from "react";
import { join } from "./join";

/**
 * The two read-only pills (issue #484). Before this, 26 were written by hand at three text sizes,
 * seven paddings and two corners, for two jobs:
 *
 *   - **`Badge`** — what state a thing is in: Live, Booked, Awaiting payment, At-Risk. A state
 *     word, set in capitals.
 *   - **`Tag`** — data: a name, a count, an amount. "Hops Tour", "2 Captain", "owes $40.00".
 *     Shown as written, because capitals make a name harder to read and change a number's look.
 *
 * Both take a `tone`, the five the app already wrote by hand: `neutral` (the default), `accent`,
 * `ok`, `warn`, `bad` — each the tone's edge, tint and text, as `<Notice>` draws them.
 *
 * The pills you press are `<Chip>` (`choice.tsx`). Lint refuses a pill written anywhere else
 * (`PILL_SELECTORS` in `eslint.config.mjs`).
 *
 * **The corner is fixed, not `rounded-full`**, for the reason `choice.tsx` gives: `rounded-full`
 * rounds to half the box's height, so a label that wraps turns the pill into an oval. A one-line
 * pill here is 15px of text plus padding, about 21px, and the corner is just over half of it.
 * The line height is set, not inherited, so a pill is the same height wherever it sits.
 *
 * `className` is for layout — `shrink-0`, `self-start`, a margin. Children may lead with a dot.
 */
export type Tone = "neutral" | "accent" | "ok" | "warn" | "bad";

const TONE: Record<Tone, string> = {
  neutral: "border-line bg-bg text-muted",
  // The accent's own edge, as each other tone has: crew home's "Changed" wears it to ask for a
  // tap (#769), and the hairline version beside it read as neutral with blue words.
  accent: "border-accent bg-bg text-accent",
  ok: "border-ok-line bg-ok-bg text-ok",
  warn: "border-warn-line bg-warn-bg text-warn",
  bad: "border-bad-line bg-bad-bg text-bad",
};

// eslint-disable-next-line no-restricted-syntax -- a pill that may wrap (issue #484): see the header
const SHAPE = "inline-flex items-center gap-1.5 rounded-[0.75rem] border px-2.5 py-0.5 leading-4";
const BADGE = "text-[11px] font-semibold uppercase tracking-wide";
const TAG = "text-xs font-medium";

type PillProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  tone?: Tone;
  children: ReactNode;
};

export function Badge({ tone = "neutral", className, children, ...props }: PillProps) {
  return (
    <span {...props} className={join(SHAPE, BADGE, TONE[tone], className)}>
      {children}
    </span>
  );
}

export function Tag({ tone = "neutral", className, children, ...props }: PillProps) {
  return (
    <span {...props} className={join(SHAPE, TAG, TONE[tone], className)}>
      {children}
    </span>
  );
}
