/**
 * The admin nav's structure and its feature filter (#174, #586, #603).
 *
 * Lives here rather than in `components/admin/admin-nav.tsx` so the filter is testable: the nav
 * is a `"use client"` island importing `next/navigation`, which a node-environment test can't
 * load. The component keeps the rendering; this keeps the decision about what a deployment is
 * allowed to see, and how it's shelved.
 *
 * WHY GROUPS. The bar reached twelve peers one task at a time and collided with the brand
 * cluster (#586). Width was the symptom; the cause is that twelve peers is not a hierarchy —
 * roughly half are edited once a season. Worse, the nav and the `/admin` hub were two separate
 * lists, and five surfaces (time off, audit, payroll, integrity check, engine pause) lived only
 * in the hub, reachable only if you happened to land there.
 *
 * THE AXIS IS CADENCE, not feature area — it's what predicts where the operator clicks. The flat
 * items are the daily work, stated by the operator directly: he works from the shifts board
 * constantly, expects to use the calendar constantly, uses the audit trail and the importer
 * daily. Everything on a weekly-or-slower rhythm is shelved behind a group.
 *
 * SHAPE, NOT RENDERING. This returns the structure; each surface decides how to draw it. Desktop
 * collapses groups into dropdowns because horizontal room is scarce. The mobile drawer is a
 * single scroll where nothing needs collapsing — flat items first and unlabeled, then the groups
 * as labeled sections. Returning `{flat, groups}` rather than one list with a `group` tag is what
 * keeps the drawer from inheriting dropdown behaviour it doesn't want.
 */

export interface AdminLink {
  href: string;
  label: string;
  /** Server-resolved flag this entry is gated on. Absent = always shown. */
  feature?: "messaging" | "reservations" | "timeClock";
}

export interface AdminGroup {
  label: string;
  links: AdminLink[];
}

export interface AdminFlags {
  messaging: boolean;
  reservations: boolean;
  timeClock: boolean;
}

/**
 * The daily work — always visible, in the operator's own order.
 *
 * At-Risk is last, and is here under protest. The operator almost never opens it ("ideally it's
 * never looked at" — he crews shifts before they land there), which argues for shelving it. It
 * stays because the shifts board does NOT currently surface at-risk state: a shift the board
 * shows as `LACKING CREW · NO TAKERS · 10h to trip` renders on the shifts board as plain
 * `Filling · 0/2 crewed` (#598). Shelve it after that lands, not before.
 */
export const FLAT_LINKS: readonly AdminLink[] = [
  { href: "/admin/shifts", label: "Shifts" },
  { href: "/admin/calendar", label: "Calendar", feature: "reservations" },
  { href: "/admin/asks", label: "Audit" },
  { href: "/admin/import", label: "Import" },
  { href: "/admin/at-risk", label: "At-Risk" },
];

/**
 * Everything on a weekly-or-slower rhythm.
 *
 * **"Crew", not "People"** (operator, 2026-08-08), reversing the earlier call.
 *
 * The reason is the bar's OTHER group: **customers are people too.** "People" didn't name the
 * boundary it was drawing — it sat two groups away from Bookings › Customers and read as though
 * it might hold them. "Crew" names exactly who these four surfaces are about.
 *
 * The earlier call avoided "Crew" because the bar also carried a **Crew view** button (the switch
 * to the crew app, DEC-093) — one word labelling two unrelated things a few dozen pixels apart.
 * **That collision no longer exists:** #709 renamed the button to "Switch to crew" and moved it
 * into the Account menu, in the same change as this rename. Recorded because the earlier decision
 * is still in the git history and reads as though the objection stands.
 */
export const GROUPS: readonly AdminGroup[] = [
  {
    label: "Bookings",
    links: [
      { href: "/admin/purchases", label: "Purchases", feature: "reservations" },
      { href: "/admin/customers", label: "Customers", feature: "reservations" },
      // Blocks is about a date's availability, not catalog data — it belongs with the booking
      // surfaces rather than with Setup.
      { href: "/admin/blocks", label: "Blocks", feature: "reservations" },
    ],
  },
  {
    label: "Crew",
    links: [
      // Ordered by how often the operator reaches for them. Time clock leads: it's
      // the one with a standing repair queue, and payroll reads what it produces.
      // Time off is set-and-forget, so it sits last (operator, 2026-08-01).
      // Distinct from Time off, which is days somebody is unavailable — this is hours
      // they actually worked (#627, SPEC §2.9).
      { href: "/admin/time-clock", label: "Time clock", feature: "timeClock" },
      { href: "/admin/payroll", label: "Payroll" },
      { href: "/admin/messages", label: "Messages", feature: "messaging" },
      { href: "/admin/time-off", label: "Time off" },
    ],
  },
  {
    label: "Setup",
    links: [
      { href: "/admin/offerings", label: "Offerings", feature: "reservations" },
      { href: "/admin/add-ons", label: "Add-ons", feature: "reservations" },
      { href: "/admin/vessels", label: "Vessels" },
      { href: "/admin/locations", label: "Locations" },
    ],
  },
  {
    label: "Settings",
    links: [
      { href: "/admin/settings", label: "Pause staffing" },
      { href: "/admin/integrity", label: "Integrity check" },
      // A relic — the relay worklist Twilio replaced — kept because it is the emergency path if
      // SMS goes dark: `app/lib/channel.ts` falls back to it when Twilio isn't configured.
      { href: "/admin/outbox", label: "Outbox" },
    ],
  },
];

const visible = (links: readonly AdminLink[], flags: AdminFlags): AdminLink[] =>
  links.filter((l) => l.feature === undefined || flags[l.feature]);

/**
 * The nav a deployment with these flags should show.
 *
 * A group whose every link is flagged off is dropped rather than rendered empty — opening
 * "Bookings" to find nothing is worse than never seeing it, the same argument that gates the
 * links themselves.
 */
export function visibleAdminNav(flags: AdminFlags): { flat: AdminLink[]; groups: AdminGroup[] } {
  return {
    flat: visible(FLAT_LINKS, flags),
    groups: GROUPS.map((g) => ({ label: g.label, links: visible(g.links, flags) })).filter(
      (g) => g.links.length > 0,
    ),
  };
}

/** Every visible link, flat first then each group's — the mobile drawer's reading order. */
export function visibleAdminLinks(flags: AdminFlags): AdminLink[] {
  const nav = visibleAdminNav(flags);
  return [...nav.flat, ...nav.groups.flatMap((g) => g.links)];
}
