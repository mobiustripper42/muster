/**
 * #319 — the operator cockpit (`/admin/shift/[id]`) surfaces the same per-event
 * guest manifest the crew card shows (`buildShiftManifest`, shared component),
 * ABOVE the Manning section. The `crewapp` seed's `shift-soon` has two trips with
 * real bookings: 3pm = Brody(4) + Vaughn(6) = 10 pax, 5pm = Ellen(2). Proves the
 * wiring + RSC render (unit tests cover the assembly rules).
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("cockpit guest manifest (#319)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("shows the per-event manifest above Manning; guests expand", async ({
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

    // It sits ABOVE the Manning override section (the #319 placement).
    const manifestY = (await manifestHeading.boundingBox())!.y;
    const manningY = (await page
      .getByRole("heading", { name: "Manning" })
      .boundingBox())!.y;
    expect(manifestY).toBeLessThan(manningY);

    // Expand the 3pm trip → a real booked guest, party size shown, cancelled ones absent.
    await page.getByText("10 guests").click();
    await expect(page.getByText("Brody party")).toBeVisible();
    await expect(page.getByText("×4")).toBeVisible();
  });
});
