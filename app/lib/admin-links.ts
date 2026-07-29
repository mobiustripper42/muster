/**
 * The admin nav's link table and its feature filter (#174, #586).
 *
 * Lives here rather than inside `components/admin/admin-nav.tsx` so the filter is testable: the
 * nav is a `"use client"` island importing `next/navigation`, which a node-environment test can't
 * load. The component keeps the rendering; this keeps the decision about what a deployment is
 * allowed to see.
 *
 * That split is worth more than the test it enables. A nav entry that leads to a switched-off
 * feature is worse than a missing one — the operator clicks, gets a flag-off notice, and learns
 * to distrust the bar. Messaging has been filtered since #389; the six reservations-era entries
 * were not, so with `RESERVATIONS` off half the bar pointed into the dark (#586).
 */
export interface AdminLink {
  href: string;
  label: string;
  /** Server-resolved flag this entry is gated on. Absent = always shown. */
  feature?: "messaging" | "reservations";
}

/** Reading order of the bar. Adding one here is the whole cost of adding a nav entry, which is
 *  exactly why there are now twelve — see the grouping note in `admin-nav.tsx`. */
export const ADMIN_LINKS: readonly AdminLink[] = [
  { href: "/admin/at-risk", label: "At-Risk" },
  { href: "/admin/outbox", label: "Outbox" },
  { href: "/admin/messages", label: "Messages", feature: "messaging" },
  { href: "/admin/import", label: "Import" },
  { href: "/admin/shifts", label: "Shifts" },
  { href: "/admin/offerings", label: "Offerings", feature: "reservations" },
  { href: "/admin/calendar", label: "Calendar", feature: "reservations" },
  { href: "/admin/purchases", label: "Purchases", feature: "reservations" },
  { href: "/admin/customers", label: "Customers", feature: "reservations" },
  { href: "/admin/add-ons", label: "Add-ons", feature: "reservations" },
  { href: "/admin/vessels", label: "Vessels" },
  { href: "/admin/locations", label: "Locations" },
  { href: "/admin/blocks", label: "Blocks", feature: "reservations" },
];

/** The links a deployment with these flags should show, in reading order. */
export function visibleAdminLinks(flags: { messaging: boolean; reservations: boolean }): AdminLink[] {
  return ADMIN_LINKS.filter((l) => l.feature === undefined || flags[l.feature]);
}
