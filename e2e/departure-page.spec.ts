/**
 * The departure page (Phase 18.8, issue #1122) — who signed which waiver and when, who was checked
 * in, and the count — reached from the calendar's booking pane and from `/admin/integrity`. The
 * rules (caps, duplicates, the warning's arithmetic, formatting) are tested in
 * `src/checkin/departure.test.ts`; here the operator opens the screens, at desktop and 375px.
 *
 * The world is `db:seed:reservation`: the first booking (Marcus Webb, party of 8) carries Marcus,
 * his minor Lily, Fred Kowalski signed twice, and Grace Kim — four people, five rows.
 */
import {
  test,
  expect,
  eventIdOfReservation,
  plantDepartureCount,
  plantWaiverTemplate,
  resetAndSeed,
  seedCrewMember,
  setSignedWaiverVersion,
  signInAsAdmin,
  signInAsCrew,
  tickGuestRow,
} from "./fixtures.js";
import { BOOKED, demoReservationId, formatShortDay } from "./reservation-demo.js";

const RID = demoReservationId(BOOKED.date, BOOKED.time);
const PANE = `/admin/calendar/${encodeURIComponent(RID)}?date=${BOOKED.date}`;
/** Late morning on the trip's own day, boat time (16:30Z is 11:30 AM or 12:30 PM in New York). */
const ON_THE_DAY = `${BOOKED.date}T16:30:00.000Z`;

/** The mate who counts and ticks — seeded here, because the reservation world has no crew. */
const MIKE = "crew-e2e-mike";

const departurePath = async () => `/admin/departure/${encodeURIComponent(await eventIdOfReservation(RID))}`;

test.describe("the departure page", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
    await seedCrewMember({ id: MIKE, name: "Mike Rossi", email: "mike@example.com" });
  });

  test("the booking pane's Waivers card says who signed and links to the departure page", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(PANE);
    const card = page.getByRole("region", { name: "Waivers" });
    await expect(card).toContainText(/Signed\s*4 · 0 checked in/);
    await expect(card).toContainText(/Counted\s*Not yet\./);
    await card.getByRole("link", { name: "See waivers ›" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/departure/`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`${formatShortDay(BOOKED.date)} · `);
  });

  test("lists every signer once, a minor under their adult, with the numbers and no count yet", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(await departurePath());
    await expect(page.getByText("Booked by")).toContainText("Marcus Webb");
    await expect(page.getByTestId("count-line")).toHaveText("Not counted yet.");
    await expect(page.getByTestId("numbers-line")).toHaveText("4 signed · 0 checked in");
    await expect(page.getByTestId("departure-warning")).toHaveCount(0);
    const people = page.getByRole("list", { name: "Signed" }).getByRole("listitem");
    await expect(people).toHaveCount(4);
    await expect(people.nth(0)).toContainText("Fred Kowalski ×2");
    await expect(people.nth(1)).toContainText("Grace Kim");
    await expect(people.nth(2)).toContainText(/Lily Webb \(\d+\) · w\/ Marcus/);
    await expect(people.nth(2)).toContainText("Signed for by Marcus Webb");
    await expect(people.nth(3)).toContainText("Marcus Webb");
    await expect(people.nth(3)).toContainText("Not checked in");
  });

  test("a row's details give the signing's evidence; a ×2 row gives both signings", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(await departurePath());
    const people = page.getByRole("list", { name: "Signed" }).getByRole("listitem");
    const fred = people.nth(0);
    await fred.getByText("Details").click();
    await expect(fred.getByText("fred-1@example.com")).toBeVisible();
    await expect(fred.getByText("fred-2@example.com")).toBeVisible();
    await expect(fred.getByText("Network address").first()).toBeVisible();
    await expect(fred.getByText("Aug 30, 1979").first()).toBeVisible();
  });

  test("the count, who ticked, and the warning when more were counted than checked in", async ({ page }) => {
    await plantDepartureCount(await eventIdOfReservation(RID), 6, ON_THE_DAY, MIKE);
    await tickGuestRow("seed-guest-grace", ON_THE_DAY, MIKE);
    await signInAsAdmin(page, "eric");
    await page.goto(await departurePath());
    await expect(page.getByTestId("count-line")).toHaveText(/^6 aboard · counted \d{1,2}:\d{2} [AP]M by Mike Rossi$/);
    await expect(page.getByTestId("numbers-line")).toHaveText("4 signed · 1 checked in");
    await expect(page.getByTestId("departure-warning")).toHaveText(
      "5 more aboard than were checked in. They may be unsigned, or signed and not ticked.",
    );
    await expect(page.getByRole("list", { name: "Signed" }).getByRole("listitem").nth(1)).toContainText(
      /✓ Checked in \d{1,2}:\d{2} [AP]M by Mike/,
    );
  });

  test("shows the exact words each signer accepted", async ({ page }) => {
    await plantWaiverTemplate({
      id: "wt-e2e-1",
      version: "brewboat-2026-v1",
      body: "Voyage Agreement — I accept the risks of the river.",
      effectiveFrom: "2026-01-01T05:00:00.000Z",
    });
    await setSignedWaiverVersion(RID, "wt-e2e-1");
    await signInAsAdmin(page, "eric");
    await page.goto(await departurePath());
    const version = page.getByRole("group").filter({ hasText: "Version of Jan 1, 2026 · 4 signed" });
    await expect(version).toBeVisible();
    await expect(page.getByText("I accept the risks of the river.")).toBeHidden();
    await version.getByText("Show text").click();
    await expect(page.getByText("I accept the risks of the river.")).toBeVisible();
  });

  test("the integrity check lists the departure and links to its page", async ({ page }) => {
    await plantDepartureCount(await eventIdOfReservation(RID), 6, ON_THE_DAY, MIKE);
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/integrity?run=1");
    const section = page.getByRole("region", { name: "Counted above checked in" });
    await expect(section).toContainText("One departure counted more people than were checked in.");
    await section.getByRole("link", { name: new RegExp(`${formatShortDay(BOOKED.date)} · .* — counted 6, checked in 0`) }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/departure/`));
    await expect(page.getByTestId("departure-warning")).toBeVisible();
  });

  test("the integrity check says so when no departure was counted above its ticks", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/integrity?run=1");
    await expect(page.getByRole("region", { name: "Counted above checked in" })).toContainText(
      "No departure counted more people than were checked in.",
    );
  });

  test("a departure that doesn't exist says so", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/departure/evt-nowhere");
    await expect(page.getByText("That departure isn’t in Muster.")).toBeVisible();
  });

  test("is for admins only", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto(await departurePath());
    await expect(page.getByTestId("numbers-line")).toHaveCount(0);
  });
});
