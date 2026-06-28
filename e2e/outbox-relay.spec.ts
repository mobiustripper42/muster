/**
 * #160 — outbox relay ergonomics. A relay card shows the copy-pasteable message
 * (body + magic link) and the recipient's number, and Send flips optimistically
 * to "sent". Web Share has no headless share sheet, so we stub `navigator.share`
 * to take the share path (no `sms:` navigation) and assert the flip.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("outbox relay (#160)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("outbox");
  });

  test("a relay card shows the copy-pasteable message + recipient, and Send flips to sent", async ({
    page,
  }) => {
    // Headless Chromium has no Web Share — define it so Send takes the share path.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: () => Promise.resolve(),
      });
    });
    await page.context().grantPermissions(["clipboard-write"]); // for the Copy flip
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/outbox");

    // Filter by Bo's number — "Bo" alone also matches "Maibock" (Mira's card).
    const bo = page.locator("article").filter({ hasText: "+15555550101" });
    await expect(bo).toBeVisible();

    // Part 1: the full message (incl. the magic link) + a Copy button that WORKS
    // (flips to "Copied ✓" — on localhost the secure-context clipboard path runs).
    await expect(bo.getByText(/crew\/auth/)).toBeVisible();
    const copy = bo.getByRole("button", { name: "Copy", exact: true });
    await expect(copy).toBeVisible();
    await copy.click();
    await expect(bo.getByRole("button", { name: /Copied/ })).toBeVisible();

    // Part 2: Send flips optimistically to the sent state.
    await bo.getByRole("link", { name: "Send" }).click();
    await expect(bo.getByText(/awaiting reply/i)).toBeVisible();
  });

  test("Dismiss (the In/Out-style red button) clears the card from the worklist", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/outbox");
    const bo = page.locator("article").filter({ hasText: "+15555550101" });
    await expect(bo).toBeVisible();

    await bo.getByRole("button", { name: "Dismiss", exact: true }).click();
    // The entry is deleted → the card is gone from the worklist on the reload.
    await expect(page.locator("article").filter({ hasText: "+15555550101" })).toHaveCount(0);
  });
});
