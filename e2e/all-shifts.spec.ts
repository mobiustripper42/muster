/**
 * #100 — the all-shifts full-visibility view + /admin nav. Asserts the list
 * renders current shifts of every state (with the At-Risk pointer to the board),
 * that the empty state is a plain "no shifts" (NOT the board's ✓ success — the
 * DEC-042 firewall), and that the /admin hub links the view (Part B).
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const plusDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

test.describe("all shifts (#100)", () => {
  test.beforeEach(async () => {
    // The at-risk seed anchors its shifts to NOW (~1–5 days out), in a mix of
    // states incl. At-Risk (Firkin regression).
    await resetAndSeed("atrisk");
  });

  test("lists current shifts in the window, with an At-Risk pointer to the board", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/shifts?from=${today()}&to=${plusDays(10)}`);

    await expect(page.getByRole("heading", { name: "All shifts" })).toBeVisible();
    // The header subtitle was dropped (8.3b); the View/Edit toggle is the mode signal.
    await expect(page.getByRole("link", { name: "Edit" })).toBeVisible();

    // A known seeded shift shows up regardless of its state…
    await expect(page.getByText("Firkin")).toBeVisible();
    // …and the At-Risk one carries the quiet board pointer, not a worked control.
    await expect(page.getByText("needs attention ↗").first()).toBeVisible();
  });

  test("empty window is a plain 'no shifts', not the board's success state", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    // 40 days out — within the clamp, past every seeded shift → empty.
    await page.goto(`/admin/shifts?from=${plusDays(40)}&to=${plusDays(40)}`);

    await expect(page.getByText(/No shifts/)).toBeVisible();
    // The board's ✓ "empty = success" copy must NOT leak here (DEC-042 firewall).
    await expect(page.getByText(/Nothing needs you/)).toHaveCount(0);
  });

  test("Split candidates filter narrows the list to long-gap shifts", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/shifts?from=${today()}&to=${plusDays(10)}`);

    // Default: everything shows; the gappy day (Barrel, 11:00 + 18:00) carries the
    // "could be two shifts" advisory, a normal shift (Firkin) does not.
    await expect(page.getByText("Barrel")).toBeVisible();
    await expect(page.getByText("Firkin")).toBeVisible();
    await expect(page.getByText(/could be two shifts/i)).toBeVisible();

    // Toggle Split candidates (next to Show cancelled) → only the candidate remains.
    await page.getByRole("link", { name: /Split candidates/i }).click();
    await expect(page).toHaveURL(/split=1/);
    await expect(page.getByText("Barrel")).toBeVisible();
    await expect(page.getByText(/could be two shifts/i)).toBeVisible();
    await expect(page.getByText("Firkin")).toHaveCount(0);
    // The count caption (the "·" separator disambiguates it from the toggle label).
    await expect(page.getByText(/split candidates? ·/i)).toBeVisible();
  });

  test("the /admin hub links the all-shifts view (Part B)", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin");
    await page.getByRole("link", { name: /All shifts/ }).click();
    await expect(page).toHaveURL(/\/admin\/shifts/);
    await expect(page.getByRole("heading", { name: "All shifts" })).toBeVisible();
  });
});
