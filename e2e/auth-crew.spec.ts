/**
 * Flow 1 + 6 (#65): dev-link → sign-in → the crew home renders its four pieces
 * (ask, my-shifts, standing, credential nudge). This is the foundation every
 * other crew flow stands on, and the credential-line copy (#57) that manual
 * eyeballing kept re-checking by hand.
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

test.describe("crew sign-in + render", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("sign-in lands on /crew with ask, my-shifts, standing, credential nudge", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");

    // Identity + own standing (§2.6.2) — name is the heading; the standing line
    // is always rendered (its copy varies, so assert presence via aria-label).
    await expect(page.getByRole("heading", { name: "Quint" })).toBeVisible();
    await expect(page.locator('p[aria-label^="Your standing:"]')).toBeVisible();

    // The open ask (§2.6.1) with its Yes/No polarity.
    await expect(page.getByText("Yes or no?")).toBeVisible();
    // exact: the page now also has a "Sign out" button (DEC-081).
    await expect(page.getByRole("button", { name: "Yes", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "No", exact: true })).toBeVisible();

    // My shifts section.
    await expect(page.getByRole("heading", { name: "My shifts" })).toBeVisible();

    // Credential nudge (#57) — assert the stable copy suffix, not the date.
    await expect(
      page.getByText(/renew it to keep getting asked for shifts/),
    ).toBeVisible();
  });

  test("no session → the signed-out state, not the app", async ({ page }) => {
    // With self-serve on (DEC-081), the signed-out state is the email sign-in
    // prompt — still NOT the app.
    await page.goto("/crew");
    await expect(
      page.getByText(/sign in with your crew email/i),
    ).toBeVisible();
    await expect(page.getByText("Yes or no?")).toHaveCount(0);
  });
});

/**
 * Already-signed-in crew shouldn't have to tap "sign in" again (#696).
 *
 * The interstitial exists because SMS link-preview bots GET the URL before the human taps, and
 * a consuming GET would burn every relayed link in transit (DEC-030). That defends against a
 * client with NO session. A crew member who is already signed in is a different case.
 */
test.describe("magic link with a live session", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  /** The production-shaped link `/crew/auth?t=…` that dev-link prints (it does NOT sign you in). */
  const magicLinkFor = async (page: import("@playwright/test").Page, crewId: string) => {
    await page.goto(`/crew/dev-link?crew=${encodeURIComponent(crewId)}`);
    const printed = (await page.locator(".url").innerText()).trim();
    const u = new URL(printed);
    return `${u.pathname}${u.search}`;
  };

  test("a matching session lands straight in the app — no tap", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    const link = await magicLinkFor(page, "crew-quint");

    await page.goto(link);

    await expect(page).toHaveURL(/\/crew$/);
    await expect(page.getByRole("heading", { name: "Quint" })).toBeVisible();
    await expect(page.getByRole("button", { name: /tap to sign in/i })).toHaveCount(0);
  });

  test("a link for a DIFFERENT crew member still asks — never silently switch identity", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    const link = await magicLinkFor(page, "crew-hooper");

    await page.goto(link);

    // The whole point: a shared phone must not drop Quint into Hooper's world, and it must
    // not LOOK like it worked either.
    await expect(page.getByRole("button", { name: /tap to sign in/i })).toBeVisible();
    await expect(page).toHaveURL(/\/crew\/auth/);
  });

  test("no session still gets the interstitial (the DEC-030 path is untouched)", async ({
    page,
  }) => {
    const link = await magicLinkFor(page, "crew-quint");
    await page.context().clearCookies();

    await page.goto(link);

    await expect(page.getByRole("button", { name: /tap to sign in/i })).toBeVisible();
  });

  test("the doorbell thread deep-link survives the skip", async ({ page }) => {
    // A ring link carries &thread=<id> so the crew member lands IN the thread they were rung
    // about (DEC-073). Skipping the tap must not drop that — landing on /crew instead would
    // make the ring useless, which is the one link where the destination is the whole point.
    await signInAsCrew(page, "crew-quint");
    const link = await magicLinkFor(page, "crew-quint");

    await page.goto(`${link}&thread=thr-demo`);

    await expect(page).toHaveURL(/\/crew\/threads\/thr-demo$/);
  });

  test("the skip does NOT consume the token — the GET stays read-only", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    const link = await magicLinkFor(page, "crew-quint");

    await page.goto(link); // auto-redirect
    await expect(page).toHaveURL(/\/crew$/);

    // Same link, no session: if the GET had consumed it, this would land on /crew?auth=consumed
    // instead of the interstitial. A browser that prefetches with cookies attached would
    // otherwise burn a link the human hasn't used yet.
    await page.context().clearCookies();
    await page.goto(link);
    await expect(page.getByRole("button", { name: /tap to sign in/i })).toBeVisible();
  });
});

