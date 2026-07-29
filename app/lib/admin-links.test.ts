/**
 * The admin nav's feature filter (#586).
 *
 * The bug this follows was a rendering collision — twelve links painting over the brand cluster
 * at 1280px — but the *cause* was that six of them shouldn't have been there at all on a
 * flag-off deployment. Layout can only be checked by looking; which links exist can be pinned,
 * so it is.
 */
import { describe, expect, it } from "vitest";
import { ADMIN_LINKS, visibleAdminLinks } from "./admin-links.js";

const labels = (flags: { messaging: boolean; reservations: boolean }) =>
  visibleAdminLinks(flags).map((l) => l.label);

describe("visibleAdminLinks", () => {
  it("shows only the always-on entries when both features are off", () => {
    // This is the default deployment: RESERVATIONS off (DEC-111), MESSAGING off (#389). Five
    // links, not twelve — which is the actual fix for the collision.
    expect(labels({ messaging: false, reservations: false })).toEqual([
      "At-Risk",
      "Outbox",
      "Import",
      "Shifts",
      "Vessels",
      "Locations",
    ]);
  });

  it("drops the six reservations entries independently of messaging", () => {
    const off = labels({ messaging: true, reservations: false });
    expect(off).toContain("Messages");
    for (const gone of ["Offerings", "Calendar", "Purchases", "Customers", "Add-ons", "Blocks"]) {
      expect(off).not.toContain(gone);
    }
  });

  it("drops Messages independently of reservations", () => {
    const off = labels({ messaging: false, reservations: true });
    expect(off).not.toContain("Messages");
    expect(off).toContain("Calendar");
  });

  it("shows every link when both are on — the e2e configuration", () => {
    expect(visibleAdminLinks({ messaging: true, reservations: true })).toHaveLength(ADMIN_LINKS.length);
  });

  it("preserves reading order under every combination", () => {
    // Filtering must not reorder: the bar's order is the operator's muscle memory.
    for (const messaging of [true, false]) {
      for (const reservations of [true, false]) {
        const shown = visibleAdminLinks({ messaging, reservations });
        const order = shown.map((l) => ADMIN_LINKS.indexOf(l));
        expect(order).toEqual([...order].sort((a, b) => a - b));
      }
    }
  });

  it("gates every entry on a flag that exists — a typo'd feature would hide a link forever", () => {
    // TypeScript catches this today; the test survives the field becoming a plain string, and a
    // link silently absent from every deployment is the kind of thing nobody reports.
    for (const l of ADMIN_LINKS) {
      if (l.feature !== undefined) expect(["messaging", "reservations"]).toContain(l.feature);
    }
  });
});
