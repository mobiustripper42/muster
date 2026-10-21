import type { InputHTMLAttributes, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { join } from "./join";

/**
 * The one field (issue #484). Every `<input>` and `<textarea>` a person types into, and every
 * `<select>` they pick from, is one of these three, and `muster/field` fails the build on
 * a raw one anywhere else — so the look below is the only place it is written, and a change to it
 * is one edit.
 *
 * **White fill, strong edge.** `--color-line-strong` clears WCAG 1.4.11's 3:1 for a control
 * boundary on a card AND on the page background (`app/globals.css`), so a field reads the same
 * wherever a page puts it. The two looks it replaced each failed one of those: white behind the
 * near-white `--color-line` vanished inside a card, and the gray-fill "well" vanished outside one.
 *
 * **Two densities.**
 *   - `touch` (default) — 44px tap floor. Text is 16px below `sm:` and `text-base` (15px under
 *     the 15px root, `app/globals.css`) from `sm:` up.
 *   - `dense` — 36px, for admin filter bars and in-row edits where six controls share a line.
 *     Text is 16px below `sm:` and `text-sm` (13.125px under the 15px root) from `sm:` up.
 * 16px is the size below which iOS Safari zooms the page on focus, so a phone field at 15px
 * jumped every time it was tapped (issue #1194). It is `calc(1rem + 1px)` because `text-base`
 * is 15px here: in rem, so a raised browser font still scales it. It stops at `sm:` because the
 * desktop boxes below were measured on the smaller text; an iPad wider than `sm:` still zooms.
 * Named `density` rather than `size` because `size` is already a native `<input>` attribute.
 *
 * **Desktop is one box (issue #1200).** From `sm:` up the tap floor goes and every field has the
 * same space between its letters and its border on all four sides — 9px at the 15px root, picked
 * by the operator from rendered mock-ups. The 44px box is the phone's, and the phone keeps it.
 *   - The height is the tallest lowercase letters (l, b, d) plus 9px above and below, plus the
 *     two border pixels: 31px for touch text, 29px for dense. In rem, so a raised browser font
 *     still grows the box. Capitals stand about 1px shorter, so on an all-caps word the gap above
 *     measures 10px at 1x. Tuning to capitals instead is parked on issue #1194.
 *   - The side padding is 7.5px, not 9: letters carry about 1.5px of side space of their own, so
 *     7.5px of padding measures 9px from the border to the ink.
 *   - The line height is the font's own (`normal`). At the text size's 1.5 a text box still
 *     centres, but a select, date or time box sets its text 1-2px high.
 *   - A textarea has no fixed height, so its top padding is what puts its first line 9px below
 *     the border; `Field`'s `align="start"` label offset is matched to that line. Tuned on touch
 *     text: a dense textarea comes out about 1px tighter, and none exists yet.
 * An odd height is deliberate: text lands on whole pixels, so the space left over after the
 * letters must be even to split equally above and below.
 *
 * **`className` is for layout** — width, `flex-1`, `font-mono`, a tracking tweak. Colour, border,
 * radius, padding and text size live here; a page that overrides one is the drift #484 fixed.
 * Focus, disabled and pointer states come from `app/globals.css` for every control (#1103).
 */
export type FieldDensity = "touch" | "dense";

/** 16px under the 15px root, below `sm:` only (issue #1194). */
const PHONE_TEXT = "text-[calc(1rem+1px)]";
/**
 * The touch field's height: the 44px floor on a phone, the desktop box (31px) from `sm:` up.
 * Written once — `DENSITY.touch` and the buttons that sit in a row beside a field wear it, so the
 * two stand level on desktop (issue #1194).
 */
export const FIELD_HEIGHT = "min-h-[44px] sm:min-h-0 sm:h-[calc(2rem+1px)]";
/** A square at that height — an icon button (✕) beside a field. Derived, so it stays square. */
export const FIELD_SQUARE = `${FIELD_HEIGHT} min-w-[44px] sm:min-w-0 sm:w-[calc(2rem+1px)] sm:px-0`;

const LOOK = "rounded-box border border-line-strong bg-card text-ink placeholder:text-muted";
const DENSITY: Record<FieldDensity, string> = {
  touch: `${FIELD_HEIGHT} px-3 ${PHONE_TEXT} sm:text-base sm:px-2 sm:leading-[normal]`,
  dense: `min-h-9 px-2 ${PHONE_TEXT} sm:min-h-0 sm:h-[calc(2rem-1px)] sm:text-sm sm:px-2 sm:leading-[normal]`,
};
// A textarea's height comes from `rows`, so it takes the padding and text size, not the floor.
const TEXTAREA_DENSITY: Record<FieldDensity, string> = {
  touch: `px-3 py-2 ${PHONE_TEXT} sm:text-base sm:px-2 sm:py-1`,
  dense: `px-2 py-1.5 ${PHONE_TEXT} sm:text-sm sm:px-2 sm:py-1`,
};
// The arrow is drawn on desktop so it can sit 9px in like the text; the browser's own is pinned
// about 6px from the edge whatever the padding. `sm:pr-8` keeps long option text clear of it.
const SELECT_ARROW = "sm:select-arrow sm:pr-8";

export function Input({
  density = "touch",
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { density?: FieldDensity; ref?: Ref<HTMLInputElement> }) {
  return <input {...props} className={join(LOOK, DENSITY[density], className)} />;
}

export function Textarea({
  density = "touch",
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  density?: FieldDensity;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  return <textarea {...props} className={join(LOOK, TEXTAREA_DENSITY[density], className)} />;
}

/**
 * The browser draws the option list, and the arrow on a phone. On desktop the arrow is drawn here
 * (`select-arrow` in `app/globals.css`), inset like the text. The box around them is the field look.
 */
export function Select({
  density = "touch",
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  density?: FieldDensity;
  ref?: Ref<HTMLSelectElement>;
}) {
  return <select {...props} className={join(LOOK, DENSITY[density], SELECT_ARROW, className)} />;
}
