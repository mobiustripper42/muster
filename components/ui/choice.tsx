import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import type { FieldDensity } from "./input";
import { join } from "./join";

/**
 * The one choice (issue #484): every tick box, radio, toggle chip and colour swatch. Same contract
 * as `input.tsx` — `no-restricted-syntax` fails the build on a raw `<input type="checkbox">` or
 * `<input type="radio">` anywhere else, so the look below is the only place it is written.
 *
 * **The label wraps the input.** Each component renders a `<label>` around its own `<input>`, so a
 * tap anywhere on the row toggles it and a screen reader reads the label as the control's name,
 * with no `id`/`htmlFor` pair to keep in step. It is also what `app/globals.css` keys the pointer
 * cursor on (`label:has(> input[type="checkbox"])`).
 *
 * **One box size.** `Checkbox` and `Radio` are 20px in the accent colour at every density; the
 * browser draws the box and the tick, the same posture as `Select`'s arrow. Before this there
 * were four sizes, six of them the browser's ~13px default. Density sets the row, not the box:
 *   - `touch` (default) — the 44px tap floor, as `py-3` around a 20px line, so a one-line label
 *     sits centred and a long one (a consent paragraph) grows down with the box beside its first
 *     line.
 *   - `dense` — no floor, for admin rows where the box sits among other controls.
 *
 * **`Chip`** is the toggle drawn as a pill: the input is visually hidden and the pill is its face.
 * Unselected takes the field edge (`--color-line-strong`); selected fills dark, the only "on"
 * state of the two the chips used to have that reads on a white card. Children are the face's
 * content and inherit its text colour — a child that sets its own (`text-muted`) vanishes on the
 * dark fill.
 *
 * **`Swatch`** is a radio whose face is a colour square, for the one picker where the colour is
 * the choice and a text pill cannot show it. `label` is its accessible name, as hidden text.
 *
 * Both hidden-input faces draw the keyboard focus ring themselves (`peer-focus-visible:`): the
 * global ring in `app/globals.css` lands on the input, which nobody can see. A chip's ring is the
 * global one; a swatch's sits further out, because its selected state is already that ring.
 *
 * **`className` is for layout**, on the label — width, `flex-1`, a divider between list rows.
 */
type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className" | "children"> & {
  ref?: Ref<HTMLInputElement>;
  /** Layout only, on the wrapping `<label>`. */
  className?: string;
  children: ReactNode;
};

// `self-start` with the row's `items-baseline`: the box sits at the top as before, and the row's
// baseline is its text's rather than the box's bottom edge — a tick box has no text, so it would
// otherwise hand a `<Field>` row a baseline 5px below the words beside it (issue #484). A lone
// baseline item falls back to the top, so nothing inside the row moves.
const BOX = "h-5 w-5 shrink-0 self-start accent-accent";
const ROW: Record<FieldDensity, string> = {
  // The row is a flex line, so each child is its own item: wrap running text that carries links
  // in one `<span>`, or the words and the links lay out side by side as columns.
  touch: "flex min-h-[44px] items-baseline gap-3 py-3 text-sm text-ink",
  dense: "flex items-baseline gap-2 text-sm text-ink",
};
const FACE_FOCUS =
  "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent";
const CHIP_FACE =
  "flex select-none items-center gap-1.5 rounded-full border border-line-strong bg-card px-3 py-1 text-sm text-muted peer-checked:border-ink peer-checked:bg-ink peer-checked:font-medium peer-checked:text-white";
const SWATCH_FACE =
  "block h-7 w-7 rounded-box border border-ink/10 peer-checked:outline peer-checked:outline-2 peer-checked:outline-offset-2 peer-checked:outline-accent";
// A swatch already says "selected" with the ring FACE_FOCUS would draw, so focus on the selected
// swatch — where Tab lands in a radio group — changed nothing on screen (@ui-reviewer). Focus
// here is a second ring outside it instead: one ring is selected, two is selected and focused.
const SWATCH_FOCUS =
  "peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-[6px]";

function Box({
  type,
  density = "touch",
  className,
  children,
  ...props
}: ChoiceProps & { type: "checkbox" | "radio"; density?: FieldDensity }) {
  return (
    <label className={join(ROW[density], className)}>
      <input {...props} type={type} className={BOX} />
      {children}
    </label>
  );
}

export function Checkbox(props: ChoiceProps & { density?: FieldDensity }) {
  return <Box {...props} type="checkbox" />;
}

export function Radio(props: ChoiceProps & { density?: FieldDensity }) {
  return <Box {...props} type="radio" />;
}

export function Chip({
  type,
  className,
  children,
  ...props
}: ChoiceProps & { type: "checkbox" | "radio" }) {
  return (
    <label className={className}>
      <input {...props} type={type} className="peer sr-only" />
      <span className={join(CHIP_FACE, FACE_FOCUS)}>{children}</span>
    </label>
  );
}

export function Swatch({
  colorClass,
  label,
  className,
  ...props
}: Omit<ChoiceProps, "children"> & { colorClass: string; label: string }) {
  return (
    <label className={className}>
      <input {...props} type="radio" className="peer sr-only" />
      <span aria-hidden className={join(SWATCH_FACE, colorClass, SWATCH_FOCUS)} />
      <span className="sr-only">{label}</span>
    </label>
  );
}
