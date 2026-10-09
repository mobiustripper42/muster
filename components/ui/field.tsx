import { useId, type ReactNode } from "react";

/**
 * A label, an optional hint, and the control they describe (issue #484). Moved here from
 * `components/admin/settings-field.tsx`, where it was the settings screens' label-left row, and
 * given a stacked layout so crew, public and filter forms stop hand-writing the same three lines.
 *
 *   - `layout="row"` — label (+ hint) on the left, right-aligned against the control on the right
 *     from `sm:` up (the settings mockups' `.f` grid). Where it sits vertically:
 *       - **with a hint**, the label is two lines or more and sits flush with the top of the
 *         control. Set on the line of a one-line field, it read as centred beside it (operator,
 *         issue #484).
 *       - **without one**, first-baseline aligned: the label sits on the line of the control's
 *         first text. `align="start"` top-aligns it instead, offset to a textarea's first line —
 *         use it for a textarea, since an empty one has no first-line baseline and baseline
 *         alignment would drop the label to its middle, and for a control with no text at all
 *         (the colour swatches), whose baseline is its bottom edge.
 *   - `layout="stacked"` (default) — label above the control, the shape every narrow form takes.
 *
 * **Every Field says what its label names, and lint refuses one that doesn't** (issue #484,
 * part 6 — `UNTIED_LABEL_SELECTORS` in `eslint.config.mjs`):
 *
 *   - `htmlFor` — one control. The label is a real `<label>` pointed at the control's `id`, so
 *     tapping it focuses the field and a screen reader announces the field by name.
 *   - `group` — several controls, or one that carries its own label: a chip set, a pair of dates,
 *     a checkbox, an editor island. The row becomes `role="group"` named by the label, so a screen
 *     reader announces "Days, group" on entering it. Not a `<fieldset>`: its `<legend>` does not
 *     sit in the row layout's grid.
 */
export function Field({
  label,
  hint,
  htmlFor,
  group,
  layout = "stacked",
  align = "baseline",
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  group?: boolean;
  layout?: "stacked" | "row";
  align?: "baseline" | "start";
  /**
   * Outer layout only — spacing between fields as a margin, a grid column. Not padding: the row
   * layout draws its own `py-3`, and `muster/layout-only` refuses padding here either way.
   */
  className?: string;
  children: ReactNode;
}) {
  const labelId = useId();
  const groupProps = group ? { role: "group", "aria-labelledby": labelId } : {};
  const text = (
    <>
      {label}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </>
  );
  const placement = hint ? "top" : align;
  const labelClass = `text-sm text-muted ${layout === "row" ? "sm:text-right" : ""} ${layout === "row" && placement === "start" ? "sm:pt-3" : ""}`;
  const labelNode = htmlFor ? (
    <label htmlFor={htmlFor} className={labelClass}>
      {text}
    </label>
  ) : (
    <span id={group ? labelId : undefined} className={labelClass}>
      {text}
    </span>
  );
  if (layout === "row") {
    return (
      <div
        {...groupProps}
        className={`grid grid-cols-1 gap-1 border-t border-line py-3 first:border-t-0 sm:grid-cols-[160px_1fr] sm:gap-3 ${
          placement === "baseline" ? "sm:items-baseline" : "sm:items-start"
        } ${className ?? ""}`}
      >
        {labelNode}
        <div>{children}</div>
      </div>
    );
  }
  return (
    <div {...groupProps} className={`flex flex-col gap-1 ${className ?? ""}`}>
      {labelNode}
      {children}
    </div>
  );
}
