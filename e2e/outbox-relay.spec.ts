/**
 * #160 — outbox relay ergonomics. A relay card shows the copy-pasteable message
 * (body + magic link) and the recipient's number, and Send flips optimistically
 * to "sent". Web Share has no headless share sheet, so we stub `navigator.share`
 * to take the share path (no `sms:` navigation) and assert the flip.
 */
import { test, expect, resetAndSeed, signInAsAdmin, clickHydrated } from "./fixtures.js";

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
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/outbox");

    // Filter by Bo's number — "Bo" alone also matches "Maibock" (Mira's card).
    const bo = page.locator("article").filter({ hasText: "+15555550101" });
    await expect(bo).toBeVisible();

    // Part 1: the full message (incl. the magic link) + a Copy button that WORKS
    // (flips to "Copied ✓" — on localhost the secure-context clipboard path runs).
    await expect(bo.getByText(/crew\/auth/)).toBeVisible();
    const copy = bo.getByRole("button", { name: "Copy", exact: true });
    await expect(copy).toBeVisible();
    await clickHydrated(copy);
    await expect(bo.getByRole("button", { name: /Copied/ })).toBeVisible();

    // Part 2: Send flips optimistically to the sent state — in the Dismiss|Send
    // pair that's the compact "Sent ✓" (the full Resend bar would overflow the cell).
    await clickHydrated(bo.getByRole("link", { name: "Send" }));
    await expect(bo.getByText("Sent ✓")).toBeVisible();
  });

  test("Dismiss (the Yes/No-style red button) clears the card from the worklist", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/outbox");
    const bo = page.locator("article").filter({ hasText: "+15555550101" });
    await expect(bo).toBeVisible();

    await bo.getByRole("button", { name: "Dismiss", exact: true }).click();
    // The entry is deleted → the card is gone from the worklist on the reload.
    await expect(page.locator("article").filter({ hasText: "+15555550101" })).toHaveCount(0);
  });

  test("a no-phone crew's RING is still relayable via Web Share (#186)", async ({
    page,
  }) => {
    // The doorbell-ring card used to gate the whole Send on `smsHref`, so a no-phone
    // crew dead-ended at "No phone on file" even where Web Share works. With the fix
    // it mirrors the ask card — RelaySend renders and offers Send on a share device.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: () => Promise.resolve(),
      });
    });
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/outbox");

    const nora = page.locator("article").filter({ hasText: "Nora No-Phone" });
    await expect(nora).toBeVisible();
    // No longer the dead-end warn…
    await expect(nora.getByText(/No phone on file/i)).toHaveCount(0);
    // …a real Send (a <button>, since there's no `sms:` href — Web Share only).
    const send = nora.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeVisible();

    // And it relays: the optimistic flip to the sent state.
    await clickHydrated(send);
    await expect(nora.getByText(/awaiting reply/i)).toBeVisible();
  });
});
