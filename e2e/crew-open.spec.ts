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

  test("presets are 7 Days / 2 Weeks / 30 Days (#414); the ~7d-out shift shows within them", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/open");
    // #414: default is now 7 Days (a pull surface — crew browse a week ahead). The
    // old "This weekend" / "Next 4 weeks" presets are gone.
    await expect(page.getByRole("link", { name: "7 Days" })).toBeVisible();
    await expect(page.getByRole("link", { name: "2 Weeks" })).toBeVisible();
    await expect(page.getByRole("link", { name: "30 Days" })).toBeVisible();
    await expect(page.getByRole("link", { name: "This weekend" })).toHaveCount(0);
    // The seeded open shift is ~7d out (the boundary of the default window); 2 Weeks
    // includes it unambiguously.
    await page.getByRole("link", { name: "2 Weeks" }).click();
    await expect(page.locator("details", { hasText: "Hops" })).toBeVisible();
  });

  test("claim flow: confirm sheet states whole-day scope, then it lands in My shifts", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto(ALL);

    // The Claim button lives inside a CLOSED <details> (out of the a11y tree until
    // opened), so open the row by its summary first, then claim. Scoped by the
    // 1:00 departure: since #440 the Asked seat on `shift-ask` lists too, so
    // "Hops" alone matches two rows.
    const row = page.locator("details", { hasText: "1:00" });
    await expect(row.locator("summary")).toBeVisible();
    await row.locator("summary").click();

    // The confirm sheet states the DEC-077 scope (whole-day + live trip count).
    // Scoped to the row — every listed row carries this copy.
    await expect(
      row.getByText(/including any trips added or cancelled later/i),
    ).toBeVisible();
    // The facts line specifically (the "(" disambiguates from the collapsed count).
    await expect(row.getByText(/2 trips \(/i)).toBeVisible();

    await row.getByRole("button", { name: /claim this shift/i }).click();

    // Lands on /crew, the seat now a confirmed row in My shifts (§2.6.2).
    await page.waitForURL((u) => u.pathname === "/crew");
    await expect(page.getByText(/you’re on the .* shift/i)).toBeVisible();
    const myShift = page.locator('a[href="/crew/shift/shift-open"]');
    await expect(myShift).toBeVisible();
    // #196: a self-claim is an opt-in, so it must NOT carry the "Added for you"
    // operator-placed badge (the seat's provenance is `self_claim`).
    await expect(myShift.getByText(/Added for you/i)).toHaveCount(0);
  });

  test("row leads with a vessel dot + right-justified departure time; confirm reads 'Currently:'", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto(ALL);

    // Scoped by the 1:00 departure — #440 lists the Asked seat's row too.
    const row = page.locator("details", { hasText: "1:00" });
    // The DEC-086 vessel identity dot the row was missing before 9.11b.
    await expect(row.locator('span[class*="bg-vessel-"]')).toBeVisible();
    // First-departure time is the collapsed row's hero (seed shift-open: 1pm & 4pm),
    // with the trip count right under it. Scope to the summary — both strings also
    // live in the (collapsed) facts line.
    await expect(row.locator("summary").getByText("1:00 PM")).toBeVisible();
    await expect(row.locator("summary").getByText("2 trips")).toBeVisible();

    await row.locator("summary").click();
    // Confirm: reworded whole-day scope (no "as captain") + the Currently: facts.
    await expect(row.getByText(/including any trips added or cancelled later/i)).toBeVisible();
    await expect(row.getByText("Currently:", { exact: true })).toBeVisible();
    await expect(row.getByText(/1:00 PM & 4:00 PM/)).toBeVisible();
  });

  test("the list is grouped under a full-weekday day header (#313)", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto(ALL);

    // The claimable seat now sits under a day-section header (not a flat stack).
    // Date-agnostic: the seed shift is ~7d out, so assert the header SHAPE — a
    // full weekday + the per-day open count — and that the Hops row is under it.
    // #440 lists a second row (the Asked seat, a different day) → one header per
    // day, so scope to the first.
    const dayHeader = page.getByRole("heading", { level: 2 }).first();
    await expect(dayHeader).toBeVisible();
    await expect(dayHeader).toContainText(
      /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),/,
    );
    await expect(dayHeader).toContainText("open");
    await expect(page.locator("details", { hasText: "1:00" })).toBeVisible();
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

test.describe("crew /crew/open — uncrewed seats stay visible (#440)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("a seat the engine has already asked on still lists — an ask is not a reservation", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto(ALL);

    // The seed's `shift-ask` (~16d out, Filling) carries an ASKED required captain
    // seat — Quint's own outstanding ask. Before #440 the Asked state hid it from
    // the browse surface entirely: uncrewed, but invisible. It lists now: two rows,
    // the Asked one identified by its trip-less "TBD" departure (it has no events).
    // Scoped to the list, not the document (#644): the crew header's menu is a `<details>` too,
    // so a bare `locator("details")` counts the drawer and would keep passing if a day row
    // vanished and the drawer took its place in the tally.
    await expect(page.locator("main section details")).toHaveCount(2);
    await expect(
      page.locator("summary", { hasText: "1:00" }), // shift-open, the Open seat
    ).toBeVisible();
    await expect(
      page.locator("summary", { hasText: "TBD" }), // shift-ask, the Asked seat
    ).toBeVisible();
  });

  test("claiming a seat that has an outstanding ask confirms the claimer", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto(ALL);

    // Open the trip-less row (the Asked seat) and claim it. The confirm sheet
    // names the whole-day scope and says the trips aren't scheduled yet.
    const askedRow = page.locator("details", { hasText: "TBD" });
    await askedRow.locator("summary").click();
    await expect(askedRow.getByText(/No trips are scheduled yet\./)).toBeVisible();
    await askedRow.getByRole("button", { name: /claim this shift/i }).click();

    // It lands in My shifts like any other claim — the outstanding ask never
    // reserved the seat against him.
    await page.waitForURL((u) => u.pathname === "/crew");
    await expect(page.locator('a[href="/crew/shift/shift-ask"]')).toBeVisible();
  });
});
