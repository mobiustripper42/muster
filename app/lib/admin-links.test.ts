/**
 * The admin nav's structure and feature filter (#586, #603).
 *
 * Layout can only be checked by looking; which links exist, where they're shelved, and in what
 * order can be pinned — so they are. The bug that started this was a rendering collision, but the
 * cause was twelve peers with no hierarchy, six of them pointing at a feature that was off.
 */
import { describe, expect, it } from "vitest";
import { FLAT_LINKS, GROUPS, visibleAdminLinks, visibleAdminNav } from "./admin-links.js";

const ALL = { messaging: true, reservations: true, timeClock: true };
const NONE = { messaging: false, reservations: false, timeClock: false };

describe("visibleAdminNav", () => {
  it("puts the daily work flat, in the operator's order", () => {
    // Stated directly by the operator: he works the shifts board constantly, expects the same of
    // the calendar, and uses audit + import daily. At-Risk is last — he almost never opens it.
    expect(visibleAdminNav(ALL).flat.map((l) => l.label)).toEqual([
      "Shifts",
      "Calendar",
      "Audit",
      "Import",
      "At-Risk",
    ]);
  });

  it("shelves everything slower behind four groups", () => {
    expect(visibleAdminNav(ALL).groups.map((g) => g.label)).toEqual([
      "Bookings",
      "Crew",
      "Setup",
      "Settings",
    ]);
  });

  it('names the crew group "Crew", not "People"', () => {
    // Reversed 2026-08-08 on the operator's call: CUSTOMERS ARE PEOPLE TOO, so "People" read as
    // though it might hold Bookings › Customers rather than naming the four crew surfaces it
    // actually holds. Pinned in both directions so the next person who spots the "Crew view"
    // button and reads this as a collision bug finds the decision instead of reverting it.
    const labels = GROUPS.map((g) => g.label);
    expect(labels).toContain("Crew");
    expect(labels).not.toContain("People");
  });

  it("drops a group whose every link is flagged off, rather than rendering it empty", () => {
    // Bookings is entirely reservations-gated. Opening an empty menu is worse than not seeing it.
    const off = visibleAdminNav(NONE);
    expect(off.groups.map((g) => g.label)).toEqual(["Crew", "Setup", "Settings"]);
    expect(off.groups.every((g) => g.links.length > 0)).toBe(true);
  });

  it("halves the bar on a default deployment", () => {
    // RESERVATIONS off (DEC-111) and MESSAGING off (#389) is the default.
    const off = visibleAdminNav(NONE);
    expect(off.flat.map((l) => l.label)).toEqual(["Shifts", "Audit", "Import", "At-Risk"]);
    expect(visibleAdminLinks(NONE).length).toBeLessThan(visibleAdminLinks(ALL).length);
  });

  it("keeps Messages gated on messaging alone, independent of reservations", () => {
    const crew = (f: Parameters<typeof visibleAdminNav>[0]) =>
      visibleAdminNav(f).groups.find((g) => g.label === "Crew")!.links.map((l) => l.label);
    expect(crew({ ...NONE, messaging: true })).toContain("Messages");
    expect(crew({ ...NONE, reservations: true })).not.toContain("Messages");
  });

  it("drops Time clock when the phase is dark, and keeps Payroll (#628)", () => {
    // The kill switch hides the punch clock, but /admin/payroll predates Phase 13 and still has
    // its estimate — gating the whole Crew group on TIME_CLOCK would take payroll down with it.
    const crew = (f: Parameters<typeof visibleAdminNav>[0]) =>
      visibleAdminNav(f).groups.find((g) => g.label === "Crew")!.links.map((l) => l.label);
    expect(crew(NONE)).not.toContain("Time clock");
    expect(crew(NONE)).toContain("Payroll");
    expect(crew({ ...NONE, timeClock: true })).toContain("Time clock");
  });

  it("shelves Blocks with Bookings, not Setup", () => {
    // It's about a date's availability, not catalog data.
    const group = (label: string) => visibleAdminNav(ALL).groups.find((g) => g.label === label)!;
    expect(group("Bookings").links.map((l) => l.label)).toContain("Blocks");
    expect(group("Setup").links.map((l) => l.label)).not.toContain("Blocks");
  });

  it("gives Settings a Pause staffing entry pointing at a real route", () => {
    // The control lived only on the /admin hub, so this menu entry could not exist until the
    // settings page did. A nav item that 404s is worse than a missing one.
    const settings = visibleAdminNav(ALL).groups.find((g) => g.label === "Settings")!;
    expect(settings.links[0]).toEqual({ href: "/admin/settings", label: "Pause staffing" });
  });

  it("surfaces the five entries the nav never linked", () => {
    // Time off, audit, payroll, integrity check and engine pause lived only in the /admin hub —
    // reachable only if you happened to land there. That is how they got orphaned.
    const all = visibleAdminLinks(ALL).map((l) => l.href);
    for (const href of [
      "/admin/time-off",
      "/admin/asks",
      "/admin/payroll",
      "/admin/integrity",
      "/admin/settings",
    ]) {
      expect(all, `${href} must be reachable from the nav`).toContain(href);
    }
  });

  it("lists every link once — nothing shelved in two places", () => {
    const hrefs = visibleAdminLinks(ALL).map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("reads flat first, then each group in order — the drawer's reading order", () => {
    const nav = visibleAdminNav(ALL);
    expect(visibleAdminLinks(ALL)).toEqual([...nav.flat, ...nav.groups.flatMap((g) => g.links)]);
  });

  it("preserves declared order under every flag combination", () => {
    // The bar's order is muscle memory; filtering must never reorder it.
    const declared = [...FLAT_LINKS, ...GROUPS.flatMap((g) => g.links)];
    for (const messaging of [true, false]) {
      for (const reservations of [true, false]) {
        for (const timeClock of [true, false]) {
          const order = visibleAdminLinks({ messaging, reservations, timeClock }).map((l) =>
            declared.findIndex((d) => d.href === l.href),
          );
          expect(order).toEqual([...order].sort((a, b) => a - b));
        }
      }
    }
  });

  it("gates every entry on a flag that exists", () => {
    // TypeScript catches this today; the test survives the field becoming a plain string, and a
    // link silently absent from every deployment is the kind of thing nobody reports.
    for (const l of [...FLAT_LINKS, ...GROUPS.flatMap((g) => g.links)]) {
      if (l.feature !== undefined)
        expect(["messaging", "reservations", "timeClock"]).toContain(l.feature);
    }
  });
});
