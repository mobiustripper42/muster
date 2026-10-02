/**
 * Crew check-in, one departure (Phase 18.5a, issue #1119). The rules — who may, the boat's limit,
 * the count's range, two phones at once — are tested in `src/checkin/check-in.test.ts` and the
 * repository contract; here the mate works the list at desktop and 375px: from the shift card's
 * **Check in**, a tap that moves the row before the server answers, undo, the boat full, a tap that
 * never arrived, the count confirmed and updated, everyone aboard, another crew's trip, and all of
 * it with JavaScript off.
 *
 * The world is the crew seed's `shift-soon`: Quint confirmed as captain, a 3:00 PM and a 5:00 PM
 * departure on Hops, which carries 12.
 */
import type { Page, Route } from "@playwright/test";
import {
  test,
  expect,
  clickHydrated,
  deleteGuestRow,
  plantGuests,
  resetAndSeed,
  signInAsCrew,
  untickGuestRow,
} from "./fixtures.js";

const SHIFT = "shift-soon";
const EVENT = "evt-soon-3pm";
const PAGE = `/crew/shift/${SHIFT}/check-in/${EVENT}`;

/** The Smith party: a parent and a child, plus Grace on her own. */
async function smiths(): Promise<void> {
  await plantGuests(EVENT, [
    { id: "g-robert", name: "Robert Smith" },
    { id: "g-kyle", name: "Kyle Smith", minorOf: "g-robert", dob: "2014-06-20" },
    { id: "g-grace", name: "Grace Kim" },
  ]);
}

const row = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name}`) });
const toBoard = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: /still to board/i }) });
const checkedIn = (page: Page) => page.locator("details", { has: page.locator("summary", { hasText: /checked in ·/i }) });

test.describe("crew check-in", () => {
  test.beforeEach(async ({ page }) => {
    await resetAndSeed("crew");
    await signInAsCrew(page, "crew-quint");
  });

  test("Check in on the departure's row opens that departure's list — alphabetical, a minor with who they came with", async ({ page }) => {
    await smiths();
    await page.goto(`/crew/shift/${SHIFT}`);
    await page.getByRole("link", { name: "Check in the 3:00 PM trip" }).click();

    await page.waitForURL(new RegExp(`${PAGE}$`));
    await expect(page.getByText(/Hops · .* · 3:00 PM/)).toBeVisible();
    // The button sits in the row but not inside its <summary>: a link inside the toggle is one
    // control inside another to a screen reader (code review, 18.5a).
    await page.goBack();
    await expect(page.getByRole("link", { name: /^Check in the/ })).toHaveCount(2);
    await expect(page.locator("summary a")).toHaveCount(0);
    await page.goForward();
    await expect(page.getByTestId("checked-in-tile")).toContainText("0");
    await expect(toBoard(page).getByRole("button")).toHaveText([/^Grace Kim/, /^Kyle Smith \(\d+\) · w\/ Robert/, /^Robert Smith/]);
  });

  test("a tap moves the row before the server answers, and Checked in takes it back", async ({ page }) => {
    await smiths();
    await page.goto(PAGE);
    // Hold every save for two seconds: the row must move while the request is still out.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route(`**${PAGE}`, async (route: Route) => {
      if (route.request().method() !== "POST") return route.continue();
      await held;
      return route.continue();
    });

    await clickHydrated(row(page, "Grace Kim"));
    await expect(toBoard(page).getByRole("button", { name: /^Grace Kim/ })).toHaveCount(0, { timeout: 1_000 });
    await expect(page.getByTestId("checked-in-tile")).toContainText("1");
    // Let it through. The route stays: released, it passes every later request straight on, and
    // unrouting with this one still pending would hand it on twice.
    release();

    // It saved: a fresh read has her aboard.
    await expect(async () => {
      await page.reload();
      await expect(checkedIn(page)).toContainText("Checked in · 1", { timeout: 2_000 });
    }).toPass();

    await checkedIn(page).locator("summary").click();
    await clickHydrated(checkedIn(page).getByRole("button", { name: /^Grace Kim/ }));
    await expect(toBoard(page).getByRole("button", { name: /^Grace Kim/ })).toBeVisible();
    await expect(async () => {
      await page.reload();
      await expect(toBoard(page).getByRole("button", { name: /^Grace Kim/ })).toBeVisible({ timeout: 2_000 });
    }).toPass();
  });

  test("when the list re-reads, it shows what another phone did — a saved tick here does not hide it", async ({ page }) => {
    await plantGuests(EVENT, [
      { id: "g-grace", name: "Grace Kim" },
      { id: "g-zed", name: "Zed Ward" },
    ]);
    await page.goto(PAGE);
    // The tick lands — the server has answered — before anything changes behind it.
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST"),
      clickHydrated(row(page, "Grace Kim")),
    ]);
    await expect(checkedIn(page)).toContainText("Checked in · 1");

    // Another phone takes Grace back off, and Zed's row goes away.
    await untickGuestRow("g-grace");
    await deleteGuestRow("g-zed");
    // This phone taps Zed: refused, so the list re-reads from the server.
    await row(page, "Zed Ward").click();

    await expect(toBoard(page).getByRole("button", { name: /^Grace Kim/ })).toBeVisible();
    await expect(page.getByTestId("checked-in-tile")).toContainText("0");
  });

  test("at the boat's limit the rows still to board stop taking taps, and the count stops there too", async ({ page }) => {
    // 13 signed on a boat that carries 12, 11 already aboard: one tick from full.
    await plantGuests(
      EVENT,
      Array.from({ length: 13 }, (_, i) => ({
        id: `g-${String(i).padStart(2, "0")}`,
        name: `Guest ${String(i).padStart(2, "0")}`,
        checkedIn: i < 11,
      })),
    );
    await page.goto(PAGE);
    // No number passes the limit: 13 signed shows as 12.
    await expect(page.getByText("Signed").locator("..")).toContainText("12");

    await clickHydrated(row(page, "Guest 11"));
    await expect(page.getByTestId("checked-in-tile")).toContainText("Full");
    await expect(page.getByTestId("checked-in-tile")).toContainText("12 of 12");
    await expect(row(page, "Guest 12")).toBeDisabled();

    // The stepper stops at 12 as well.
    await expect(page.getByLabel("Passengers")).toHaveValue("12");
    await expect(page.getByRole("button", { name: "One more passenger" })).toBeDisabled();

    // Taking one back frees the spot.
    await checkedIn(page).locator("summary").click();
    await checkedIn(page).getByRole("button", { name: /^Guest 00/ }).click();
    await expect(row(page, "Guest 12")).toBeEnabled();
  });

  test("a tap that never reaches the server says so, and Retry saves it", async ({ page }) => {
    await smiths();
    await page.goto(PAGE);
    await page.route(`**${PAGE}`, (route: Route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );

    await clickHydrated(row(page, "Grace Kim"));
    await checkedIn(page).locator("summary").click();
    await expect(page.getByText("Didn’t save")).toBeVisible();

    await page.unroute(`**${PAGE}`);
    // Wait for the save itself: "Didn't save" goes the moment the retry starts, and a reload
    // before the answer would cut the retry off.
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST"),
      page.getByRole("button", { name: "Retry Grace Kim" }).click(),
    ]);
    await expect(page.getByText("Didn’t save")).toHaveCount(0);
    await page.reload();
    await expect(checkedIn(page)).toContainText("Checked in · 1");
  });

  test("the count starts at the number signed; confirm it, then update it", async ({ page }) => {
    await smiths();
    await page.goto(PAGE);
    await expect(page.getByLabel("Passengers")).toHaveValue("3");

    await clickHydrated(page.getByRole("button", { name: "One more passenger" }));
    await page.getByRole("button", { name: "Confirm 4 aboard and depart" }).click();
    await expect(page.getByText(/✓ 4 aboard · counted .* by Quint/)).toBeVisible();

    await clickHydrated(page.getByRole("button", { name: "One fewer passenger" }));
    await page.getByRole("button", { name: "Update count" }).click();
    await expect(page.getByText(/✓ 3 aboard · counted .* by Quint/)).toBeVisible();
  });

  test("when the last one boards, the list says everyone's aboard", async ({ page }) => {
    await plantGuests(EVENT, [{ id: "g-grace", name: "Grace Kim" }]);
    await page.goto(PAGE);
    await clickHydrated(row(page, "Grace Kim"));
    await expect(page.getByText("Everyone’s aboard")).toBeVisible();
  });

  test("an empty trip says nobody has signed; another crew's trip is not shown at all", async ({ page }) => {
    await page.goto(`/crew/shift/${SHIFT}/check-in/evt-soon-5pm`);
    await expect(page.getByText("Nobody has signed for this trip yet.")).toBeVisible();

    // Growler's trip is Gilly's shift, not Quint's — whichever shift the address names.
    await page.goto("/crew/shift/shift-soon-growler/check-in/evt-soon-growler-1pm");
    await expect(page.getByText("That trip isn’t on your list.")).toBeVisible();
    await page.goto(`/crew/shift/${SHIFT}/check-in/evt-soon-growler-1pm`);
    await expect(page.getByText("That trip isn’t on your list.")).toBeVisible();
  });

  test.describe("with JavaScript off", () => {
    test.use({ javaScriptEnabled: false });

    test("a tap and the count still work — each a round trip", async ({ page }) => {
      await smiths();
      await page.goto(PAGE);
      await row(page, "Grace Kim").click();
      await expect(checkedIn(page)).toContainText("Checked in · 1");

      await page.getByLabel("Passengers").fill("5");
      await page.getByRole("button", { name: "Confirm and depart" }).click();
      await expect(page.getByText(/✓ 5 aboard · counted .* by Quint/)).toBeVisible();
    });
  });
});
