import type { ComponentProps, ReactNode } from "react";
import { AppLink } from "../ui/app-link";

/**
 * A choice already made, restated (issue #484, gap audit part B): the trip on the checkout and the
 * pay link ("Your trip"), the trip on the operator's phone booking ("Their trip"), who a pay link's
 * booking is for ("Booked for"). It was written four times with the same label and the same box.
 *
 * A white box with an edge and no fill, inside a card: it is read, not pressed, so it has no
 * card's shadow and no field's strong edge. `changeHref` adds a Change link back to where the
 * choice was made. Other props (a `data-testid`) go on the box; the caller's wrapper places it.
 */
export function Recap({
  label,
  changeHref,
  children,
  ...props
}: { label: string; changeHref?: string; children: ReactNode } & Omit<ComponentProps<"div">, "children" | "className">) {
  return (
    <>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-muted">{label}</div>
      <div {...props} className="flex items-center gap-2.5 rounded-box border border-line px-3.5 py-3 text-sm">
        <span className="min-w-0 flex-1">{children}</span>
        {changeHref && (
          <AppLink href={changeHref} className="btn-quiet text-xs">
            Change
          </AppLink>
        )}
      </div>
    </>
  );
}
