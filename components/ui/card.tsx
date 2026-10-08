import type { ComponentProps, ElementType, ReactNode } from "react";
import { join } from "./join";

/**
 * The one card and the one well (issue #484, part 4). Every white box a page groups content in is
 * a `<Card>`, and every grey box set inside one is a `<Well>`; `muster/surface` fails the
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
 *     own padding (a divided list, a table, a card under a `CardHeader`); `nav` for a list of
 *     links whose rows draw their own padding and selected fill (`SideList`); `fold` for a
 *     `<details>` card whose `<summary>` owns the top as its 44px tap area; `sides` for a card
 *     around one touch control that draws its own height (a consent `Checkbox`). Padding is a
 *     prop, never a `className` — `muster/layout-only` holds it: Tailwind resolves `px-4 px-6` by
 *     stylesheet order, not class order, so an override can silently lose.
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
 * **`CardHeader`** is the strip at the top of a card: a title, then on the right a `hint` or an
 * `action`, and under the title a note (`children`). It goes first inside a `<Card pad="none">`,
 * or first inside a form that fills one; the body under it draws its own padding. Before it, the
 * strip was written twelve times in seven files, and `muster/surface` now refuses it by hand.
 *
 * **`className` is for layout** — flex, gap, grid, overflow, sticky, a width, a margin. A tinted
 * message box is not a card: that is `<Notice>`.
 */
type Box<T extends ElementType> = { as?: T; className?: string } & Omit<ComponentProps<T>, "as" | "className">;

type CardPad = "normal" | "none" | "nav" | "fold" | "sides";
type CardEdge = "line" | "accent" | "bad" | "link";

type CardTone = "ok" | "bad" | "warn";

const CARD_LOOK = "rounded-box border shadow-sm";
const CARD_PAD: Record<CardPad, string> = {
  normal: "px-4 py-3",
  none: "",
  nav: "p-1.5",
  fold: "px-4 pb-3",
  sides: "px-4",
};
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

export function CardHeader({
  title,
  hint,
  action,
  children,
}: {
  title: ReactNode;
  /** Muted text on the right — what the section is for. */
  hint?: ReactNode;
  /** A control on the right, centred against the title. */
  action?: ReactNode;
  /** A note under the title. */
  children?: ReactNode;
}) {
  return (
    <div className={join("flex gap-3 border-b border-line px-4 py-3", action ? "items-center" : "items-baseline")}>
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {children && <p className="mt-1 text-xs text-muted">{children}</p>}
      </div>
      {hint && <span className="ml-auto text-right text-xs text-muted">{hint}</span>}
      {/* `flex`, so the control is a flex item: an inline one in a block would sit on a text line
          and add its strut's height to the strip. */}
      {action && <div className="ml-auto flex shrink-0">{action}</div>}
    </div>
  );
}

export type { Box };
