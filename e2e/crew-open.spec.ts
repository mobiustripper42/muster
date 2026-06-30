/**
 * 7.3 (#183): the /crew/open self-serve pull surface. Quint (captain) has one
 * claimable shift in the seed (`shift-open`, ~7d out, an Open required captain
 * seat). Covers: the default-today empty window, the claim flow end-to-end (row →
 * confirm sheet → Claim → it lands in My shifts), and the clean-failure banners.
 *
 * The race ("just taken") and conflict ("already have a shift that day") DOMAIN
 * logic is exhaustively unit-tested in src/asks/claim.test.ts; here we assert the
 * SURFACE renders each as its banner copy (the UI half of the AC).
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

// A range wide enough to clear the [today, today+45d] clamp, so the ~7d-out
// seeded shift shows regardless of which weekday the run lands on.
const ALL = "/crew/open?from=2020-01-01&to=2099-12-31";

test.describe("crew /crew/open — pick up a shift", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("default window is today → the ~7d-out shift isn't shown (empty reads as normal)", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/open");
    await expect(page.getByText(/nothing open in this window/i)).toBeVisible();
  });

  test("claim flow: confirm sheet states whole-day scope, then it lands in My shifts", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto(ALL);

    // The Claim button lives inside a CLOSED <details> (out of the a11y tree until
    // opened), so open the row by its summary first, then claim.
    const summary = page.locator("summary", { hasText: "Hops" });
    await expect(summary).toBeVisible();
    await summary.click();

    // The confirm sheet states the DEC-077 scope (whole-day + live trip count).
    await expect(page.getByText(/every trip booked, including any added later/i)).toBeVisible();
    await expect(page.getByText(/2 trips/i)).toBeVisible();

    await page.getByRole("button", { name: /claim this shift/i }).click();

    // Lands on /crew, the seat now a confirmed row in My shifts (§2.6.2).
    await page.waitForURL((u) => u.pathname === "/crew");
    await expect(page.getByText(/you’re on the .* shift/i)).toBeVisible();
    await expect(page.locator('a[href="/crew/shift/shift-open"]')).toBeVisible();
  });

  test("a since-taken claim shows the clean 'just taken' message", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/open?claim_error=just_taken");
    await expect(page.getByText(/grabbed that one first/i)).toBeVisible();
  });

  test("a same-date conflict shows the 'already have a shift that day' message", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/open?claim_error=conflict");
    await expect(page.getByText(/already have a shift that day/i)).toBeVisible();
  });
});
