/**
 * #319 — the operator cockpit (`/admin/shift/[id]`) surfaces the same per-event
 * guest manifest the crew card shows (`buildShiftManifest`, shared component),
 * BELOW the seat cards. The `crewapp` seed's `shift-soon` has two trips with
 * real bookings: 3pm = Brody(4) + Vaughn(6) = 10 pax, 5pm = Ellen(2). Proves the
 * wiring + RSC render (unit tests cover the assembly rules).
 *
 * The placement assertion used to pin the manifest ABOVE the Manning section; the
 * Manning UI is withdrawn, so it now pins against the Crewed-gate summary that
 * closes the seat list.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("cockpit guest manifest (#319)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("shows the per-event manifest below the seat list; guests expand", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shift/shift-soon");

    // The manifest section rendered, with the per-event pax summaries visible
    // (guests themselves sit in a collapsed <details> until expanded).
    const manifestHeading = page.getByRole("heading", { name: /Manifest/ });
    await expect(manifestHeading).toBeVisible();
    await expect(page.getByText("10 guests")).toBeVisible(); // 3pm: Brody 4 + Vaughn 6
    await expect(page.getByText("2 guests")).toBeVisible(); //  5pm: Ellen 2

    // It sits BELOW the seat list (the #319 placement, re-anchored on the
    // Crewed-gate summary now that Manning is gone).
    const manifestY = (await manifestHeading.boundingBox())!.y;
    const gateY = (await page
      .getByText(/required seats confirmed/)
      .boundingBox())!.y;
    expect(manifestY).toBeGreaterThan(gateY);

    // Expand the 3pm trip → a real booked guest, party size shown, cancelled ones absent.
    await page.getByText("10 guests").click();
    await expect(page.getByText("Brody party")).toBeVisible();
    await expect(page.getByText("×4")).toBeVisible();

    // Brody has a phone → Call + Text buttons (the seat-card idiom). Call is the
    // bare tel:; Text is an sms: with the #345 intro message PRELOADED in ?&body=.
    await expect(page.locator('a[href="tel:+15555551111"]')).toHaveText(/Call/);
    const textLink = page.locator('a[href^="sms:+15555551111?&body="]');
    await expect(textLink).toHaveText(/Text/);
    const body = decodeURIComponent((await textLink.getAttribute("href"))!);
    // Sender = the signed-in operator (Spink); the static location + map pin; the
    // dynamic day-of phrasing. (Departure time varies with the seed, so not pinned.)
    expect(body).toContain("Hi, this is Spink with BrewBoat");
    expect(body).toContain("I'll be taking you out at");
    expect(body).toContain("today. Please confirm the pickup location: Canal Basin Park near Flatiron Cafe.");
    expect(body).toContain("https://maps.app.goo.gl/A2vG7Q9LjKdZJpod9");
    await expect(page.getByText("Vaughn party")).toBeVisible();
    // Two of the three seeded guests have phones (Brody 3pm, Ellen 5pm) → two Call
    // links WITHIN the manifest; phone-less Vaughn contributes none. Scope to the
    // manifest region so the crew seat-card Call buttons elsewhere don't count.
    const manifest = page.getByRole("region", { name: "Manifest" });
    await expect(manifest.locator('a[href^="tel:"]')).toHaveCount(2);
  });

  test("tapping a guest's Text records the contact; the shared ✓ then shows (#345 Part B)", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shift/shift-soon");
    await page.getByText("10 guests").click(); // expand the 3pm trip (Brody has a phone)
    const manifest = page.getByRole("region", { name: "Manifest" });
    await expect(manifest.getByText(/Texted by/)).toHaveCount(0); // nobody contacted yet

    // Tap Text → the client island fires the record (then hands off to Messages,
    // which headless Chromium can't open — noWaitAfter so the click doesn't hang).
    const textLink = manifest.locator('a[href^="sms:+15555551111?&body="]');
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/guest-contact")),
      textLink.click({ noWaitAfter: true }),
    ]);
    expect(resp.status()).toBe(204);

    // Any subsequent render (the sender reloads, or another crew loads it) shows the
    // shared mark — "✓ Texted by Spink · <time>".
    await page.goto("/admin/shift/shift-soon");
    await page.getByText("10 guests").click();
    await expect(manifest.getByText(/✓ Texted by Spink/)).toBeVisible();
  });
});
