import type { ReactNode } from "react";

/**
 * A label, an optional hint, and the control they describe (issue #484). Moved here from
 * `components/admin/settings-field.tsx`, where it was the settings screens' label-left row, and
 * given a stacked layout so crew, public and filter forms stop hand-writing the same three lines.
 *
 *   - `layout="row"` — label (+ hint) on the left, control on the right from `sm:` up, first-
 *     baseline aligned (the settings mockups' `.f` grid). `align="start"` top-aligns the label:
 *     use it for a textarea, since an empty one has no first-line baseline and baseline alignment
 *     would drop the label to its middle.
 *   - `layout="stacked"` (default) — label above the control, the shape every narrow form takes.
 *
 * **`htmlFor` makes the label a real `<label>`** pointed at the control's `id`, so tapping it
 * focuses the field and a screen reader announces the field by name. Without it the label is a
 * `<span>`: the right shape when the row holds several controls (a pair of numbers, a checkbox
 * with its own label) and there is no single one to point at.
 */
export function Field({
  label,
  hint,
  htmlFor,
  layout = "stacked",
  align = "baseline",
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  layout?: "stacked" | "row";
  align?: "baseline" | "start";
  /** Outer layout only — spacing between fields, a grid column. */
  className?: string;
  children: ReactNode;
}) {
  const text = (
    <>
      {label}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </>
  );
  if (layout === "row") {
    const labelClass = `text-sm text-muted ${align === "start" ? "sm:pt-2" : ""}`;
    return (
      <div
        className={`grid grid-cols-1 gap-1 border-t border-line py-3 first:border-t-0 sm:grid-cols-[160px_1fr] sm:gap-3 ${
          align === "start" ? "sm:items-start" : "sm:items-baseline"
        } ${className ?? ""}`}
      >
        {htmlFor ? (
          <label htmlFor={htmlFor} className={labelClass}>
            {text}
          </label>
        ) : (
          <span className={labelClass}>{text}</span>
        )}
        <div>{children}</div>
      </div>
    );
  }
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-sm text-muted">
          {text}
        </label>
      ) : (
        <span className="text-sm text-muted">{text}</span>
      )}
      {children}
    </div>
  );
}
