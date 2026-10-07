import type { ComponentProps, ElementType } from "react";
import { join } from "./join";

/**
 * The one card and the one well (issue #484, part 4). Every white box a page groups content in is
 * a `<Card>`, and every grey box set inside one is a `<Well>`; `no-restricted-syntax` fails the
 * build on a class string that writes either look by hand (`eslint.config.mjs`, beside the field
 * rule), so the looks below are the only place they are written.
 *
 * **One card look: edge, white fill, radius and shadow.** Before this, 55 cards carried
 * `shadow-sm` and 40 did not, sometimes on one page; the public pages ran a second radius. The
 * shadow is what lifts white off the grey page, the same reason the field got its strong edge.
 *
 *   - `as` — the element. A card is a `section`, a `nav`, a `details`, a list, a link
 *     (`as={AppLink}`); the look does not care, and the element's own props pass through.
 *   - `pad` — `normal` (default) for a card holding content; `none` for one whose rows draw their
 *     own padding (a divided list, a table, a nav rail adding its own `p-1.5`). Padding is a prop,
 *     never a `className`: Tailwind resolves `px-4 px-6` by stylesheet order, not class order, so
 *     an override can silently lose.
 *   - `edge` — `line` (default); `accent` for the selected or new one; `bad` for one in error;
 *     `link` for a card that is itself a link, which takes the accent edge on hover.
 *   - `tone` — a tinted tile that still sits among cards: the crew's Shift Start beside a white
 *     First departure, the engine's Running/Paused. It replaces the fill and the edge and keeps the
 *     shadow, so the pair reads as one row. A tinted box that only says something is `<Notice>`.
 *
 * **`Well`** is the grey inset: a block of text to read (a waiver), a group of details, a row you
 * can drag. It belongs inside a card — grey on the grey page vanishes, the reason the field look
 * moved off it (`input.tsx`). One padding.
 *
 * **`className` is for layout** — flex, gap, grid, overflow, sticky, a width. A tinted message
 * box is not a card: that is `<Notice>`.
 */
type Box<T extends ElementType> = { as?: T; className?: string } & Omit<ComponentProps<T>, "as" | "className">;

type CardPad = "normal" | "none";
type CardEdge = "line" | "accent" | "bad" | "link";

type CardTone = "ok" | "bad" | "warn";

const CARD_LOOK = "rounded-box border shadow-sm";
const CARD_PAD: Record<CardPad, string> = { normal: "px-4 py-3", none: "" };
const CARD_EDGE: Record<CardEdge, string> = {
  line: "border-line bg-card",
  accent: "border-accent bg-card",
  bad: "border-bad bg-card",
  link: "border-line bg-card hover:border-accent",
};
const CARD_TONE: Record<CardTone, string> = {
  ok: "border-ok-line bg-ok-bg",
  bad: "border-bad-line bg-bad-bg",
  warn: "border-warn-line bg-warn-bg",
};
const WELL_LOOK = "rounded-box border border-line bg-bg px-3 py-2";

export function Card<T extends ElementType = "div">({
  as,
  pad = "normal",
  edge = "line",
  tone,
  className,
  ...props
}: Box<T> & { pad?: CardPad; edge?: CardEdge; tone?: CardTone }) {
  const Tag: ElementType = as ?? "div";
  const face = tone ? CARD_TONE[tone] : CARD_EDGE[edge];
  return <Tag {...props} className={join(CARD_LOOK, face, CARD_PAD[pad], className)} />;
}

export function Well<T extends ElementType = "div">({ as, className, ...props }: Box<T>) {
  const Tag: ElementType = as ?? "div";
  return <Tag {...props} className={join(WELL_LOOK, className)} />;
}

export type { Box };
