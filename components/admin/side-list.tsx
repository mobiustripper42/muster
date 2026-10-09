import type { ReactNode } from "react";
import { AppLink } from "../ui/app-link";
import { Card } from "../ui/card";
import { join } from "../ui/join";

/**
 * The settings list column (issue #484, gap audit part B): add-ons, locations, offerings and
 * vessels each pick one thing from a list on the left and edit it on the right. The column was
 * written four times — the card, the capitals label, the selected row, the dashed "+ New" link —
 * and is one component now.
 *
 *   - `SideList` — the card and its label. `className` is layout (`self-start`).
 *   - `SideListLink` — one row; `current` is the one open on the right. What a row says (a
 *     Retired label, an offering count, a vessel's colour) is the caller's.
 *   - `SideListNew` — the dashed link that opens a blank form; `current` while it is open.
 *
 * Anything else a list needs (the offerings' "Show hidden") goes in as a plain child.
 */
export function SideList({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <Card as="nav" pad="nav" className={join("flex flex-col gap-0.5", className)}>
      <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      {children}
    </Card>
  );
}

export function SideListLink({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <AppLink
      href={href}
      aria-current={current ? "page" : undefined}
      // eslint-disable-next-line muster/surface -- the selected row's grey, not a well (issue #484): drawn here once
      className={`block rounded-box px-2.5 py-2 text-sm ${current ? "bg-bg font-medium text-ink" : "text-muted"}`}
    >
      {children}
    </AppLink>
  );
}

export function SideListNew({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <AppLink
      href={href}
      className={`mx-0.5 mt-1.5 rounded-box border border-dashed border-line px-2.5 py-2 text-sm text-accent ${
        current ? "font-medium" : ""
      }`}
    >
      {children}
    </AppLink>
  );
}
