/**
 * Crew calendar feed (#355, DEC-098) — mint a subscribable iCal link, serve it as
 * live text/calendar, and rotate it. `crew-quint` (the crew seed) holds one CONFIRMED
 * shift on "Hops" with co-crew Hooper, so the feed has real content.
 *
 * The token is hash-only and shown ONCE at mint; these tests grab it from the
 * readonly field, fetch the feed with Playwright's request context (a calendar client
 * sends no session — the token IS the credential), and prove rotate kills the old URL.
 *
 * NB the displayed URL uses APP_BASE_URL (the real external origin — correct for
 * prod), which in the e2e env may point at a different host than the test server. So
 * we fetch the PATH, which `page.request` resolves against the test `baseURL`.
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

/** The feed path on the test server (the shown URL's origin is APP_BASE_URL). */
const feedPath = (url: string): string => new URL(url).pathname;

test.describe("crew calendar feed (#355)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("mint → shown once → the URL serves valid ICS (skeleton only, no PII)", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/calendar");

    // No feed yet → create one.
    await page.getByRole("button", { name: /create my calendar link/i }).click();

    // Shown exactly once — read it from the readonly field.
    const field = page.getByLabel("Your calendar feed link");
    await expect(field).toBeVisible();
    const feedUrl = await field.inputValue();
    expect(feedUrl).toMatch(/\/api\/calendar\/.+\.ics$/);

    // The feed serves text/calendar with the confirmed shift — and NO guest/phone PII.
    const res = await page.request.get(feedPath(feedUrl));
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/calendar");
    const ics = await res.text();
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("SUMMARY:Hops"); // vessel + role
    expect(ics).toContain("UID:"); // stable per-shift UID
    expect(ics).not.toContain("+1555"); // no phone numbers cross into the feed

    // "Done" hides the URL; the feed stays live (now shown as on).
    await page.getByRole("button", { name: /i.ve saved it/i }).click();
    await expect(page.getByText(/your calendar sync is on/i)).toBeVisible();
    // The one-time URL is no longer on screen.
    await expect(page.getByLabel("Your calendar feed link")).toHaveCount(0);
  });

  test("regenerate rotates the token — old URL 404s, unknown token 404s (no oracle)", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/calendar");
    await page.getByRole("button", { name: /create my calendar link/i }).click();
    const firstUrl = await page
      .getByLabel("Your calendar feed link")
      .inputValue();
    expect((await page.request.get(feedPath(firstUrl))).status()).toBe(200);

    // Save, then make a new link (rotate).
    await page.getByRole("button", { name: /i.ve saved it/i }).click();
    await page.getByRole("button", { name: /make a new link/i }).click();
    const secondUrl = await page
      .getByLabel("Your calendar feed link")
      .inputValue();
    expect(secondUrl).not.toBe(firstUrl);

    // New URL works; the rotated-away old one is dead.
    expect((await page.request.get(feedPath(secondUrl))).status()).toBe(200);
    expect((await page.request.get(feedPath(firstUrl))).status()).toBe(404);

    // A bogus token → 404, same generic response (no oracle).
    const bogus = feedPath(secondUrl).replace(/\/[^/]+\.ics$/, "/deadbeefdeadbeef.ics");
    expect((await page.request.get(bogus)).status()).toBe(404);
  });
});
