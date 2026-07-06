import type { ReactNode } from "react";
import { AppLink } from "./app-link";

/**
 * The one back-link for the crew drill-in surfaces (#237, Phase 9.11) — "‹ Shifts"
 * / "‹ Home" / "‹ Messages". Was duplicated as a bare `text-sm` link on every crew
 * page (~20px tall, below the 44px touch target); this gives it one home with a
 * real 44px hit area. The chevron is `aria-hidden` — the label is the accessible
 * name. `-ml-1 px-1` widens the tap zone without shifting the left edge.
 *
 * `prefetch={false}` passes through for the messaging back-links, which opt out of
 * prefetch to keep the thread list from warming on hover.
 */
export function BackLink({
  href,
  children,
  prefetch,
}: {
  href: string;
  children: ReactNode;
  prefetch?: boolean;
}) {
  return (
    <AppLink
      href={href}
      {...(prefetch === false ? { prefetch: false } : {})}
      className="-ml-1 inline-flex min-h-[44px] items-center gap-1 px-1 text-sm font-semibold text-accent"
    >
      <span aria-hidden>‹</span>
      {children}
    </AppLink>
  );
}
