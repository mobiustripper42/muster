/**
 * Phase 9.11 crew reconciliation (#237) — the identity/voice adopts that landed on
 * the crew surfaces. Guards the three behaviours the mockups have that the live
 * surfaces gained: a vessel identity dot on My-shifts rows (DEC-086), the calmer
 * empty-shifts copy, and the co-crew role glyph + label on the shift card.
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

test.describe("crew reconciliation — identity + voice (9.11)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("My-shifts row leads with a vessel identity dot (DEC-086)", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    // Quint's confirmed shift-soon renders a My-shifts row; the row carries the
    // aria-hidden vessel hue dot — same hue system as the admin board.
    const row = page.locator('a[href="/crew/shift/shift-soon"]');
    await expect(row).toBeVisible();
    await expect(row.locator('span[class*="bg-vessel-"]')).toBeVisible();
    // The vessel name stays the accessible answer (the dot is aria-hidden).
    await expect(row).toContainText("Hops");
  });

  test("empty My-shifts reads as calm-normal, not a bare line", async ({ page }) => {
    // Dooley has a full reliability history but no shifts/asks → the empty state.
    await signInAsCrew(page, "crew-dooley");
    await expect(page.getByText(/Nothing booked right now/i)).toBeVisible();
    await expect(page.getByText(/you’ll get a ping/i)).toBeVisible();
  });

  test("shift card shows each co-crew member's role (glyph + label)", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/shift/shift-soon");
    // Co-crew Hooper is the mate — the row shows the name, the visible role label
    // (the accessible answer), and the mate-hue role glyph beside it.
    const coCrew = page.locator("section", { hasText: "Crewing with you" });
    await expect(coCrew).toContainText("Hooper");
    await expect(coCrew.getByText(/·\s*mate/i)).toBeVisible();
    await expect(coCrew.locator('span[class*="bg-mate"]')).toBeVisible();
  });
});
