/**
 * The booker's party page, `/b/<code>/party` (Phase 18.6, issue #1120). Spec:
 * `docs/design/check-in-surfaces.md` §B. The rules — who is one person, the count's caps — are
 * tested in `src/checkin/party.test.ts` and `duplicates.test.ts`; here the booker opens the page at
 * desktop and 375px.
 *
 * The world is `db:seed:reservation`: the first booking (Marcus Webb, party of 8) carries Marcus,
 * his minor Lily, Fred Kowalski signed twice, and Grace Kim — four people.
 */
import { test, expect, cancelReservationRow, resetAndSeed } from "./fixtures.js";
import { BOOKED, demoBookingCode, demoReservationId, demoRevokedBookingCode } from "./reservation-demo.js";

const RID = demoReservationId(BOOKED.date, BOOKED.time);
const CODE = demoBookingCode(RID);
const PARTY = `/b/${CODE}/party`;

test.describe("the booker's party page", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("every signed name, a duplicate once as ×2, a minor's age, and the count", async ({ page }) => {
    await page.goto(PARTY);
    await expect(page.getByText(/Your BrewBoat trip/)).toBeVisible();
    // Fred signed twice: one person, so 4 of 8, not 5.
    await expect(page.getByTestId("party-count")).toHaveText("4 of 8 signed");
    await expect(page.getByText("Four people still need to sign.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Who has signed" }).getByRole("listitem")).toHaveText([
      /Fred Kowalski ×2$/,
      /Grace Kim$/,
      /Lily Webb \(\d+\)$/,
      /Marcus Webb$/,
    ]);
    // The boat is never named to a customer.
    await expect(page.getByText(/Brew [0-9]/)).toHaveCount(0);
  });

  test("Share the link carries the departure's trip link, which opens the signing page", async ({ page }) => {
    await page.goto(PARTY);
    await expect(page.getByRole("button", { name: "Share the link" })).toBeVisible();
    const link = await page.locator(".select-all").textContent();
    expect(link).toMatch(/\/w\/[0-9A-Z]{8}$/);
    // The same link on a second look — made once, never again.
    await page.reload();
    await expect(page.locator(".select-all")).toHaveText(link!);
    await page.goto(new URL(link!).pathname);
    await expect(page.getByText(/Your details|Waivers aren’t open/)).toBeVisible();
  });

  test("a cancelled booking says so, with no names and nothing to share", async ({ page }) => {
    await cancelReservationRow(RID);
    await page.goto(PARTY);
    await expect(page.getByRole("heading", { name: "This trip was cancelled" })).toBeVisible();
    await expect(page.getByText("Fred Kowalski")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Share the link" })).toHaveCount(0);
  });

  test("a code that does not open a booking lands on the manage page's own states", async ({ page }) => {
    await page.goto("/b/ZZZZZZZZZZZZZZ/party");
    await expect(page.getByRole("heading", { name: "This booking link isn’t valid" })).toBeVisible();
    await page.goto(`/b/${demoRevokedBookingCode(RID)}/party`);
    await expect(page.getByRole("heading", { name: "This booking link was replaced" })).toBeVisible();
  });
});
