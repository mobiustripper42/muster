/**
 * The crew drawer's contents and its feature filter (#644).
 *
 * Lives here rather than in the component for the same reason `admin-links.ts` does: the drawer
 * is a `"use client"` island importing `next/navigation`, which a node-environment test can't
 * load. This keeps the decision about what a deployment is allowed to see; the component keeps
 * the rendering.
 *
 * **WHY A DRAWER AT ALL, when `/crew` is already a hub.** #644 asked that question and left it
 * open. The operator answered it on 2026-08-05 by naming the real problem: the hub *was* the
 * menu. Five full-width navigation cards — Messages, Time, Time off, Calendar sync, Pick up a
 * shift — opened the app, and "My shifts" began **637px down an 812px screen**. 78% of the first
 * phone view was chrome. Nobody decided that; it accrued one DEC at a time (DEC-074, DEC-091,
 * DEC-098, DEC-009, §7.6), and SPEC §2.6's own reconciliation note records the count drifting
 * from three to "four" without an amendment. It is five.
 *
 * So this is a **move, not an addition**: the drawer holds navigation, the hub holds work. There
 * is no second path to the same routes — the cards are gone from the hub. That is the difference
 * between this and the duplicate-hub the issue warned about.
 *
 * **What deliberately did NOT move: "Pick up a shift."** DEC-074 calls it "an invitation, not a
 * demand", and it is an offer of WORK rather than a way to reach a utility. Burying an offer in a
 * menu changes what it is (operator, 2026-08-05). It stays on the hub as the only card.
 *
 * **Messages is here behind its existing flag and is currently off.** It carries an unread count,
 * and a badge inside a closed drawer is invisible — the honest fix is a dot on the hamburger.
 * That is not built, because messaging is dark until there's a native app (operator, 2026-08-05).
 * **If messaging is ever re-enabled, this is the open question to answer first.**
 */

export interface CrewLink {
  href: string;
  label: string;
  /** Server-resolved flag this entry is gated on. Absent = always shown. */
  feature?: "messaging" | "timeClock";
}

export interface CrewFlags {
  messaging: boolean;
  timeClock: boolean;
}

/**
 * Flat and unlabeled — seven routes is not a hierarchy, and the admin nav's grouping solved a
 * twelve-peer width problem the crew app does not have (SPEC §2.6: "insultingly small"). The
 * order is the hub's own, which is the order the operator arranged these in.
 *
 * `/crew` leads so the drawer always offers the way back to work from anywhere, including from a
 * surface whose back link points somewhere else.
 */
const CREW_LINKS: CrewLink[] = [
  { href: "/crew", label: "My shifts" },
  { href: "/crew/threads", label: "Messages", feature: "messaging" },
  { href: "/crew/time", label: "Time", feature: "timeClock" },
  { href: "/crew/time-off", label: "Time off" },
  { href: "/crew/calendar", label: "Calendar sync" },
  { href: "/crew/help", label: "How Muster works" },
];

/** The drawer's links for this deployment. Sign out and Switch to admin are not links — they're
 *  server-action forms, so the component renders them below this list. */
export function visibleCrewLinks(flags: CrewFlags): CrewLink[] {
  return CREW_LINKS.filter((l) => (l.feature ? flags[l.feature] : true));
}
