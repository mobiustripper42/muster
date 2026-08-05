/**
 * Crew messaging UI (#117, §10): the in-app chat surface end-to-end over the real
 * routes + DB + session + server actions + the activity beacon.
 *
 *  1. Home → Messages → the thread list shows the standing threads (all-staff +
 *     the shift thread), compose into one and see the message land.
 *  2. Start a DM from a shift card's co-crew list → compose → see it land.
 *
 * Unread/read-state/presence logic is unit-tested (thread-list/thread-view specs);
 * this proves the wiring — routing, membership gate, find-or-create on first post,
 * and the DM number-privacy entry point.
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

test.describe("crew messaging", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("thread list → compose in a standing thread → message lands", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");

    // Discoverable from home — via the drawer since #644, where the nav cards moved.
    await page.locator(`summary[aria-label="Open menu"]`).click();
    await page.getByRole("link", { name: "Messages" }).click();
    await page.waitForURL(/\/crew\/threads$/);

    // The standing threads quint belongs to: all-staff + the shift thread (Hops).
    await expect(page.getByRole("link", { name: /All staff/ })).toBeVisible();
    await page.getByRole("link", { name: /Hops/ }).click();
    await page.waitForURL(/\/crew\/threads\/.+/);

    // Empty until posted, then the message appears after the server action.
    await expect(page.getByText(/No messages yet/)).toBeVisible();
    const body = "Dock is slip B today, call 12:30";
    await page.getByRole("textbox").fill(body);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText(body)).toBeVisible();
    await expect(page.getByText(/No messages yet/)).toHaveCount(0);
  });

  test("start a DM from a shift card → compose → message lands", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");

    // The co-crew "Message" button opens the DM (the §6 number-privacy channel).
    await page.goto("/crew/shift/shift-soon");
    await page.getByRole("button", { name: "Message Hooper" }).click();
    await page.waitForURL(/\/crew\/threads\/.+/);

    // The DM is titled by the other person, and starts empty.
    await expect(page.getByRole("heading", { name: "Hooper" })).toBeVisible();
    const body = "You good for the 3pm?";
    await page.getByRole("textbox").fill(body);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText(body)).toBeVisible();
  });
});
