import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from "react";

/**
 * The one text field (issue #484). Every `<input>` and `<textarea>` a person types into is one
 * of these two, and `no-restricted-syntax` fails the build on a raw one anywhere else — so the
 * look below is the only place it is written, and a change to it is one edit.
 *
 * **White fill, strong edge.** `--color-line-strong` clears WCAG 1.4.11's 3:1 for a control
 * boundary on a card AND on the page background (`app/globals.css`), so a field reads the same
 * wherever a page puts it. The two looks it replaced each failed one of those: white behind the
 * near-white `--color-line` vanished inside a card, and the gray-fill "well" vanished outside one.
 *
 * **Two densities.**
 *   - `touch` (default) — 44px tap floor, 16px text. 16px is also the size below which iOS
 *     Safari zooms the page on focus, so a public form at 15px jumped every time it was tapped.
 *   - `dense` — 36px, 14px text, for admin filter bars and in-row edits where six controls
 *     share a line.
 * Named `density` rather than `size` because `size` is already a native `<input>` attribute.
 *
 * **`className` is for layout** — width, `flex-1`, `font-mono`, a tracking tweak. Colour, border,
 * radius, padding and text size live here; a page that overrides one is the drift #484 fixed.
 * Focus, disabled and pointer states come from `app/globals.css` for every control (#1103).
 */
export type FieldDensity = "touch" | "dense";

const LOOK = "rounded-card border border-line-strong bg-card text-ink placeholder:text-muted";
const DENSITY: Record<FieldDensity, string> = {
  touch: "min-h-[44px] px-3 text-base",
  dense: "min-h-9 px-2 text-sm",
};
// A textarea's height comes from `rows`, so it takes the padding and text size, not the floor.
const TEXTAREA_DENSITY: Record<FieldDensity, string> = {
  touch: "px-3 py-2 text-base",
  dense: "px-2 py-1.5 text-sm",
};

function join(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * The field look as a class string, for a `<select>` sitting beside these until the Select task
 * gives it a component of its own. Exported for that one use: an `<input>` that reached for it
 * would still be a raw `<input>`, which lint already refuses.
 */
export function fieldClass(density: FieldDensity = "touch"): string {
  return join(LOOK, DENSITY[density]);
}

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
