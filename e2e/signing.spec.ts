/**
 * The waiver signing page, /w/<code> (Phase 18.4, issue #1118). The rules — ages, the ten-minor cap,
 * refusals, the group count — are unit-tested in `src/checkin/signing.test.ts`; here a guest walks
 * each path end to end at desktop and 375px. The page opens straight on the form (operator,
 * 2026-10-01): an adult alone, an adult who adds minors with "+ Add a minor" and takes one away
 * again, the ten-minor limit, the same with JavaScript off, the party step, a refusal that keeps what
 * was typed, a throttled submit, and a trip with no waiver posted.
 *
 * The trip is a private charter (one booking, party of 4) unless a test plants a second booking.
 */
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  cancelReservationRow,
  clickHydrated,
  exhaustRateLimit,
  plantBookedReservation,
  plantTripLink,
  plantWaiverTemplate,
  resetAndSeed,
} from "./fixtures.js";
import { MAX_CHILDREN, SIGNING_LIMIT } from "../src/checkin/signing.js";

const CODE = "K3F9QZ2M";
const EVENT = `evt-trip-${CODE}`;

async function charter(): Promise<void> {
  await plantTripLink({ code: CODE, date: "2030-06-01", time: "15:00" });
  await plantBookedReservation({ id: "resv-smith", eventId: EVENT, customerName: "Carol Smith", partySize: 4 });
  await plantWaiverTemplate({
    id: "wt-live",
    version: "brewboat-2026-v1",
    body: "Voyage Agreement\n\nI accept the risks of a boat trip.",
    effectiveFrom: "2026-01-01T05:00:00.000Z",
  });
}

async function fillAdult(page: Page, over: { email?: string } = {}): Promise<void> {
  await page.getByLabel("Full legal name").first().fill("Fred Kowalski");
  await page.getByLabel(/this is my full legal name/i).check();
  await page.locator('select[name="dobMonth"]').selectOption("4");
  await page.locator('select[name="dobDay"]').selectOption("2");
  await page.locator('select[name="dobYear"]').selectOption("1980");
  await page.getByLabel("Email").fill(over.email ?? "fred@example.com");
}

const childName = (page: Page, i: number) => page.locator('input[name="childName"]').nth(i);

/** Fill the i-th child card (0-based, in page order). */
async function fillChild(page: Page, i: number, name: string, year: string): Promise<void> {
  await childName(page, i).fill(name);
  await page.locator('select[name="childMonth"]').nth(i).selectOption("6");
  await page.locator('select[name="childDay"]').nth(i).selectOption("20");
  await page.locator('select[name="childYear"]').nth(i).selectOption(year);
}

const addChild = (page: Page) => page.getByRole("button", { name: "+ Add a minor" });

async function agreeAndSign(page: Page): Promise<void> {
  await expect(page.getByText("I accept the risks of a boat trip.")).toBeVisible();
  await page.getByLabel(/I agree to sign electronically/i).check();
  await page.getByRole("button", { name: "Sign", exact: true }).click();
}

test.describe("waiver signing /w/<code>", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew"); // vessel-hops
  });

  test("an adult signs for themselves — the link opens straight on the form", async ({ page }) => {
    await charter();
    await page.goto(`/w/${CODE}`);
    await expect(page.getByText("Sat, Jun 1 · 3:00 PM")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Minor 1" })).toHaveCount(0);

    await fillAdult(page);
    await agreeAndSign(page);

    await page.waitForURL(/signed=/);
    await expect(page.getByRole("heading", { name: "You’re all set, Fred" })).toBeVisible();
    await expect(page.getByText("Your group: 1 of 4 signed")).toBeVisible();
    await expect(page.getByText("Three people still need to sign.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Share with your party" })).toBeVisible();

    // Sign for someone else starts a fresh form on the same phone.
    await page.getByRole("link", { name: "Sign for someone else" }).click();
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
    await expect(page.getByLabel("Full legal name").first()).toHaveValue("");
  });

  test("+ Add a minor adds a card on the phone, with no round trip — two minors count toward the group", async ({ page }) => {
    await charter();
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST") posts.push(r.url());
    });
    await page.goto(`/w/${CODE}`);
    await fillAdult(page);

    await clickHydrated(addChild(page));
    await expect(page.getByRole("heading", { name: "Minor 1" })).toBeVisible();
    // The new card's name field takes the focus: add, type, add, type.
    await expect(childName(page, 0)).toBeFocused();
    await fillChild(page, 0, "Kyle Kowalski", "2014");
    await addChild(page).click();
    await expect(childName(page, 1)).toBeFocused();
    await fillChild(page, 1, "Amy Kowalski", "2019");
    // Everything typed is still there: adding a card sent nothing to the server.
    await expect(page.getByLabel("Full legal name").first()).toHaveValue("Fred Kowalski");
    expect(posts).toEqual([]);

    await agreeAndSign(page);
    await page.waitForURL(/signed=/);
    await expect(page.getByText("Your group: 3 of 4 signed")).toBeVisible();
    await expect(page.getByText("One person still needs to sign.")).toBeVisible();
  });

  test("Remove takes that minor away, the cards after it renumber, and the focus moves to the add button", async ({ page }) => {
    await charter();
    await page.goto(`/w/${CODE}`);
    await fillAdult(page);
    await clickHydrated(addChild(page));
    await fillChild(page, 0, "Kyle Kowalski", "2014");
    await addChild(page).click();
    await fillChild(page, 1, "Amy Kowalski", "2019");
    await addChild(page).click();
    await fillChild(page, 2, "Zoe Kowalski", "2021");

    await page.getByRole("button", { name: "Remove minor 2" }).click();
    await expect(page.getByRole("heading", { name: "Minor 3" })).toHaveCount(0);
    // The focus does not fall off the page with the card: it lands on "+ Add a minor".
    await expect(addChild(page)).toBeFocused();
    await expect(childName(page, 0)).toHaveValue("Kyle Kowalski");
    await expect(childName(page, 1)).toHaveValue("Zoe Kowalski");
    await expect(page.locator('select[name="childYear"]').nth(1)).toHaveValue("2021");

    await agreeAndSign(page);
    await page.waitForURL(/signed=/);
    await expect(page.getByText("Your group: 3 of 4 signed")).toBeVisible();
  });

  test(`${MAX_CHILDREN} minors is the most: the add button goes at ${MAX_CHILDREN} and comes back after a remove`, async ({ page }) => {
    await charter();
    await page.goto(`/w/${CODE}`);
    await clickHydrated(addChild(page));
    for (let i = 1; i < MAX_CHILDREN; i++) await addChild(page).click();

    await expect(page.getByRole("heading", { name: `Minor ${MAX_CHILDREN}`, exact: true })).toBeVisible();
    await expect(addChild(page)).toHaveCount(0);
    await expect(page.getByText(`${MAX_CHILDREN} minors is the most on one signature.`)).toBeVisible();

    await page.getByRole("button", { name: "Remove minor 4" }).click();
    await expect(addChild(page)).toBeVisible();
    // The button was not on the page when Remove was tapped; the focus still finds it.
    await expect(addChild(page)).toBeFocused();
  });

  test("a refusal comes back with everything still typed, the child cards included", async ({ page }) => {
    await charter();
    await page.goto(`/w/${CODE}`);
    // The browser accepts an address with no dot in the domain; the server does not.
    await fillAdult(page, { email: "fred@nowhere" });
    await clickHydrated(addChild(page));
    await fillChild(page, 0, "Kyle Kowalski", "2014");
    await agreeAndSign(page);

    await page.waitForURL(/err=bad_email/);
    await expect(page.getByText(/enter an email address we can reach you at/i)).toBeVisible();
    await expect(page.getByLabel("Full legal name").first()).toHaveValue("Fred Kowalski");
    await expect(page.locator('select[name="dobYear"]')).toHaveValue("1980");
    await expect(page.getByLabel("Email")).toHaveValue("fred@nowhere");
    await expect(page.getByRole("heading", { name: "Minor 1" })).toBeVisible();
    await expect(childName(page, 0)).toHaveValue("Kyle Kowalski");
    await expect(page.locator('select[name="childYear"]').nth(0)).toHaveValue("2014");
    await expect(page.getByLabel(/I agree to sign electronically/i)).toBeChecked();

    // Refused again, at the very same address: a card added since the first refusal comes back
    // with its child too, not blank after React's post-submit form reset (the #699 bug's shape).
    await clickHydrated(addChild(page));
    await fillChild(page, 1, "Amy Kowalski", "2019");
    const sign = page.getByRole("button", { name: "Sign", exact: true });
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), sign.click()]);
    await expect(sign).toBeEnabled(); // the refusal has rendered and the form has been reset
    await expect(childName(page, 0)).toHaveValue("Kyle Kowalski");
    await expect(childName(page, 1)).toHaveValue("Amy Kowalski");
    await expect(page.locator('select[name="childYear"]').nth(1)).toHaveValue("2019");
  });

  test("on a shared departure the guest says who they're with first — surnames only, or walk-up", async ({ page }) => {
    await charter();
    await plantBookedReservation({ id: "resv-nowak", eventId: EVENT, customerName: "Piotr Nowak", partySize: 2 });
    await page.goto(`/w/${CODE}`);

    await expect(page.getByRole("heading", { name: "Who are you here with?" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Nowak · party of 2/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /I’m a walk-up/ })).toBeVisible();
    await expect(page.getByText("Carol")).toHaveCount(0);
    await page.getByRole("link", { name: /Smith · party of 4/ }).click();

    await fillAdult(page);
    await agreeAndSign(page);
    await page.waitForURL(/signed=/);
    await expect(page.getByText("Your group: 1 of 4 signed")).toBeVisible();
  });

  test("past the per-connection limit, Sign is refused and nothing typed is lost", async ({ page }) => {
    await charter();
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.99" });
    await page.goto(`/w/${CODE}`);
    await fillAdult(page);
    await exhaustRateLimit(SIGNING_LIMIT, "203.0.113.99");
    await agreeAndSign(page);

    await page.waitForURL(/err=throttled/);
    await expect(page.getByText(/lots of people are signing from this connection/i)).toBeVisible();
    await expect(page.getByLabel("Full legal name").first()).toHaveValue("Fred Kowalski");
  });

  test("if the waiver changes while the guest is typing, they see the new words and must tick again", async ({ page }) => {
    await charter();
    await page.goto(`/w/${CODE}`);
    await fillAdult(page);
    await page.getByLabel(/I agree to sign electronically/i).check();
    // The operator posts new words between the form loading and Sign.
    await plantWaiverTemplate({
      id: "wt-new",
      version: "brewboat-2026-v2",
      body: "Voyage Agreement, revised.",
      effectiveFrom: "2026-02-01T05:00:00.000Z",
    });
    await page.getByRole("button", { name: "Sign", exact: true }).click();

    await page.waitForURL(/err=waiver_changed/);
    await expect(page.getByText(/the waiver was just updated/i)).toBeVisible();
    await expect(page.getByText("Voyage Agreement, revised.")).toBeVisible();
    // Agreeing to the old words is not agreeing to the new ones.
    await expect(page.getByLabel(/I agree to sign electronically/i)).not.toBeChecked();
    await expect(page.getByLabel("Full legal name").first()).toHaveValue("Fred Kowalski");
  });

  test("if the chosen party is cancelled mid-form, the guest picks again and keeps what they typed", async ({ page }) => {
    await charter();
    await plantBookedReservation({ id: "resv-nowak", eventId: EVENT, customerName: "Piotr Nowak", partySize: 2 });
    await page.goto(`/w/${CODE}?party=resv-nowak`);
    await fillAdult(page);
    await cancelReservationRow("resv-nowak");
    await agreeAndSign(page);

    await page.waitForURL(/err=bad_party/);
    await expect(page.getByText("Pick who you’re here with.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Nowak/ })).toHaveCount(0);
    await page.getByRole("link", { name: /I’m a walk-up/ }).click();
    await expect(page.getByLabel("Full legal name").first()).toHaveValue("Fred Kowalski");
    await expect(page.getByLabel("Email")).toHaveValue("fred@example.com");
  });

  test("with no waiver posted, there is nothing to sign", async ({ page }) => {
    await plantTripLink({ code: CODE, date: "2030-06-01", time: "15:00" });
    await page.goto(`/w/${CODE}`);
    await expect(page.getByRole("heading", { name: "Waivers aren’t open for this trip yet" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your details" })).toHaveCount(0);
  });

  test.describe("with JavaScript off", () => {
    test.use({ javaScriptEnabled: false });

    test("+ Add a minor and Remove still work — each is a round trip that keeps everything typed", async ({ page }) => {
      // The progressive-enhancement half of DEC-147 rule 2: the island makes adding a child
      // instant, and without it the same buttons post the form and come back with one more card.
      await charter();
      await page.goto(`/w/${CODE}`);
      await fillAdult(page);

      await addChild(page).click();
      await page.waitForURL(/restore=1/);
      await expect(page.getByLabel("Full legal name").first()).toHaveValue("Fred Kowalski");
      await fillChild(page, 0, "Kyle Kowalski", "2014");

      await addChild(page).click();
      await expect(page.getByRole("heading", { name: "Minor 2" })).toBeVisible();
      await expect(childName(page, 0)).toHaveValue("Kyle Kowalski");
      await fillChild(page, 1, "Amy Kowalski", "2019");

      await page.getByRole("button", { name: "Remove minor 1" }).click();
      await expect(page.getByRole("heading", { name: "Minor 2" })).toHaveCount(0);
      await expect(childName(page, 0)).toHaveValue("Amy Kowalski");
      await expect(page.getByLabel("Email")).toHaveValue("fred@example.com");

      await agreeAndSign(page);
      await page.waitForURL(/signed=/);
      await expect(page.getByText("Your group: 2 of 4 signed")).toBeVisible();
    });
  });
});
