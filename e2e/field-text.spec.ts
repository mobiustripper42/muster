/**
 * Field text size on a phone and on desktop (issue #1194).
 *
 * iOS Safari zooms the page when a focused field's text is under 16px. The fields drew 15px
 * (`text-base` under the 15px root, `app/globals.css`), so every tap on a public form jumped. The
 * fix is 16px below `sm:` only: issue #1200's desktop boxes were measured on the old sizes, and
 * desktop must come out unchanged.
 *
 * Registered in the `iphone` project's testMatch (WebKit, phone width) for the phone half; the
 * desktop half runs on `desktop`. Each test skips on the project that isn't its own.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";
import type { Locator, Page } from "@playwright/test";

async function fontSize(field: Locator): Promise<string> {
  return field.evaluate((el) => getComputedStyle(el).fontSize);
}

/**
 * Seed as `e2e/customers.spec.ts` does, sign in, then reach `/admin/customers`. On WebKit a `goto`
 * straight after sign-in can be interrupted by the client router taking over
 * (`e2e/admin-nav.spec.ts`, issue #659), so the visit is retried until the search box is there.
 */
async function openCustomers(page: Page): Promise<Locator> {
  await resetAndSeed("reservation");
  await signInAsAdmin(page, "eric");
  const search = page.getByLabel("Search customers");
  await expect(async () => {
    await page.goto("/admin/customers");
    await expect(search).toBeVisible({ timeout: 5_000 });
  }).toPass();
  return search;
}

test.describe("field text size (issue #1194)", () => {
  test("AC1: on a phone, /b/find's touch field computes 16px", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "iphone", "the phone half runs on the iphone project");
    await page.goto("/b/find");
    const field = page.locator("#find-contact");
    await expect(field).toBeVisible();
    expect(await fontSize(field)).toBe("16px");
  });

  test("AC2: on desktop, /b/find's touch field is still 15px text in a 31px box", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the desktop half runs on the desktop project");
    await page.goto("/b/find");
    const field = page.locator("#find-contact");
    await expect(field).toBeVisible();
    expect(await fontSize(field)).toBe("15px");
    const box = await field.boundingBox();
    expect(box?.height, "issue #1200's desktop box").toBeCloseTo(31, 0);
  });

  test("AC12: on a phone, the dense customer search computes 16px", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "iphone", "the phone half runs on the iphone project");
    const search = await openCustomers(page);
    expect(await fontSize(search)).toBe("16px");
  });

  test("AC12: on desktop, the dense customer search is still 13.125px text in a 29px box", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the desktop half runs on the desktop project");
    const search = await openCustomers(page);
    // `text-sm` is 0.875rem under the 15px root.
    expect(await fontSize(search)).toBe("13.125px");
    const box = await search.boundingBox();
    expect(box?.height, "issue #1200's dense desktop box").toBeCloseTo(29, 0);
  });
});
