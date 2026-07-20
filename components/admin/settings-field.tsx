import type { ReactNode } from "react";

/**
 * Shared input styling for the settings forms (12.9 vessel/location, and the P12 catalog
 * screens to come). **`bg-bg`, not `bg-card`:** a white input inside a white card, separated
 * only by the near-white `--color-line`, is almost invisible — the fields read as a subtle
 * recessed well against the card instead. A proper app-wide input-contrast pass is tracked
 * separately; this is the settings-form standard until then.
 */
export const settingsInputClass = "rounded-card border border-line bg-bg px-3 py-2 text-ink";

/**
 * One label-left field row (the settings mockups' `.f` grid): label (+ optional sublabel) on
 * the left, control on the right, first-baseline aligned. `align="start"` top-aligns the label
 * — use it for a textarea, since an empty one has no first-line baseline and baseline alignment
 * would drop the label to its middle.
 */
export function Field({
  label,
  sub,
  align = "baseline",
  children,
}: {
  label: string;
  sub?: string;
  align?: "baseline" | "start";
  children: ReactNode;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-1 border-t border-line py-3 first:border-t-0 sm:grid-cols-[160px_1fr] sm:gap-3 ${
        align === "start" ? "sm:items-start" : "sm:items-baseline"
      }`}
    >
      <span className={`text-sm text-muted ${align === "start" ? "sm:pt-2" : ""}`}>
        {label}
        {sub && <span className="block text-xs text-faint">{sub}</span>}
      </span>
      <div>{children}</div>
    </div>
  );
}
