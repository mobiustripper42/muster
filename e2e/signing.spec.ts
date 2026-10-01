/**
 * The waiver signing page, /w/<code> (Phase 18.4, issue #1118). The rules — ages, the ten-kid cap,
 * refusals, the group count — are unit-tested in `src/checkin/signing.test.ts`; here a guest walks
 * each path end to end at desktop and 375px: adult, adult + kids, child only, the party step, a
 * refusal that keeps what was typed, a throttled submit, and a trip with no waiver posted.
 *
 * The trip is a private charter (one booking, party of 4) unless a test plants a second booking.
 */
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  cancelReservationRow,
  exhaustRateLimit,
  plantBookedReservation,
  plantTripLink,
  plantWaiverTemplate,
  resetAndSeed,
} from "./fixtures.js";
import { SIGNING_LIMIT } from "../src/checkin/signing.js";

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

async function fillChild(page: Page, i: number, name: string, year: string): Promise<void> {
  await page.locator(`input[name="childName${i}"]`).fill(name);
  await page.locator(`select[name="childMonth${i}"]`).selectOption("6");
  await page.locator(`select[name="childDay${i}"]`).selectOption("20");
  await page.locator(`select[name="childYear${i}"]`).selectOption(year);
}

async function agreeAndSign(page: Page): Promise<void> {
  await expect(page.getByText("I accept the risks of a boat trip.")).toBeVisible();
  await page.getByLabel(/I agree to sign electronically/i).check();
  await page.getByRole("button", { name: "Sign" }).click();
}

test.describe("waiver signing /w/<code>", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew"); // vessel-hops
  });

  test("an adult signs for themselves and lands on the success screen with the group count", async ({ page }) => {
    await charter();
    await page.goto(`/w/${CODE}`);
    await expect(page.getByText("Sat, Jun 1 · 3:00 PM")).toBeVisible();
    await page.getByRole("link", { name: "Myself (18+)" }).click();

    await fillAdult(page);
    await agreeAndSign(page);

    await page.waitForURL(/signed=/);
    await expect(page.getByRole("heading", { name: "You’re all set, Fred" })).toBeVisible();
    await expect(page.getByText("Your group: 1 of 4 signed")).toBeVisible();
    await expect(page.getByText("Three people still need to sign.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Share with your party" })).toBeVisible();

    // Sign for someone else starts a fresh form on the same phone.
    await page.getByRole("link", { name: "Sign for someone else" }).click();
    await expect(page.getByRole("link", { name: "Myself (18+)" })).toBeVisible();
  });

  test("an adult signs for themselves and two kids — the kids count toward the group", async ({ page }) => {
    await charter();
    await page.goto(`/w/${CODE}`);
    await page.getByRole("link", { name: "Me + my kids" }).click();
    await expect(page.getByRole("heading", { name: "How many kids?" })).toBeVisible();
    await page.getByRole("link", { name: "2", exact: true }).click();

    await fillAdult(page);
    await fillChild(page, 0, "Kyle Kowalski", "2014");
    await fillChild(page, 1, "Amy Kowalski", "2019");
    await agreeAndSign(page);

    await page.waitForURL(/signed=/);
    await expect(page.getByText("Your group: 3 of 4 signed")).toBeVisible();
    await expect(page.getByText("One person still needs to sign.")).toBeVisible();
  });

  test("a parent signs for a child", async ({ page }) => {
    await charter();
    await page.goto(`/w/${CODE}`);
    await page.getByRole("link", { name: "A child (under 18)" }).click();
    await page.getByRole("link", { name: "1", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your details (parent or guardian)" })).toBeVisible();

    await fillAdult(page);
    await fillChild(page, 0, "Kyle Kowalski", "2014");
    await agreeAndSign(page);

    await page.waitForURL(/signed=/);
    await expect(page.getByText("Your group: 2 of 4 signed")).toBeVisible();
  });

  test("a refusal comes back with everything still typed", async ({ page }) => {
    await charter();
    await page.goto(`/w/${CODE}?for=me`);
    // The browser accepts an address with no dot in the domain; the server does not.
    await fillAdult(page, { email: "fred@nowhere" });
    await agreeAndSign(page);

    await page.waitForURL(/err=bad_email/);
    await expect(page.getByText(/enter an email address we can reach you at/i)).toBeVisible();
    await expect(page.getByLabel("Full legal name").first()).toHaveValue("Fred Kowalski");
    await expect(page.locator('select[name="dobYear"]')).toHaveValue("1980");
    await expect(page.getByLabel("Email")).toHaveValue("fred@nowhere");
    await expect(page.getByLabel(/I agree to sign electronically/i)).toBeChecked();
  });

  test("on a shared departure the guest says who they're with — surnames only, or walk-up", async ({ page }) => {
    await charter();
    await plantBookedReservation({ id: "resv-nowak", eventId: EVENT, customerName: "Piotr Nowak", partySize: 2 });
    await page.goto(`/w/${CODE}`);
    await page.getByRole("link", { name: "Myself (18+)" }).click();

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
    await page.goto(`/w/${CODE}?for=me`);
    await fillAdult(page);
    await exhaustRateLimit(SIGNING_LIMIT, "203.0.113.99");
    await agreeAndSign(page);

    await page.waitForURL(/err=throttled/);
    await expect(page.getByText(/lots of people are signing from this connection/i)).toBeVisible();
    await expect(page.getByLabel("Full legal name").first()).toHaveValue("Fred Kowalski");
  });

  test("if the waiver changes while the guest is typing, they see the new words and must tick again", async ({ page }) => {
    await charter();
    await page.goto(`/w/${CODE}?for=me`);
    await fillAdult(page);
    await page.getByLabel(/I agree to sign electronically/i).check();
    // The operator posts new words between the form loading and Sign.
    await plantWaiverTemplate({
      id: "wt-new",
      version: "brewboat-2026-v2",
      body: "Voyage Agreement, revised.",
      effectiveFrom: "2026-02-01T05:00:00.000Z",
    });
    await page.getByRole("button", { name: "Sign" }).click();

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
    await page.goto(`/w/${CODE}?for=me&party=resv-nowak`);
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
    await expect(page.getByRole("link", { name: "Myself (18+)" })).toHaveCount(0);
  });
});
