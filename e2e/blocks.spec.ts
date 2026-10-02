/**
 * Blocks registry (task 12.10, DEC-125; reason-first since issue #1091) — drives /admin/blocks end
 * to end in the operator's words: the editor asks what's happening before it asks for anything
 * else, says how many departures came off the calendar, and Unblock asks before it puts them back.
 * Domain validation and impact math are unit-tested; this is the surface. Runs desktop + 375px.
 *
 * The `reservation` seed builds a LIVE offering + owned days + two materialized bookings on
 * vessel-brew-3 at the dates the seed derives for today (#646), so the conflict count is real.
 */
import type { Page } from "@playwright/test";
import { DEMO } from "./reservation-demo.js";
import { test, expect, resetAndSeed, signInAsAdmin, clickHydrated } from "./fixtures.js";

const BOAT_OUT = /A boat is out of service/;
const CLOSURE = /A dock or the river is closed/;
const ONE_DEPARTURE = /Hold one departure/;

/** The editor's three answers to "What's happening?" — present only while nothing is chosen. */
async function choose(page: Page, answer: RegExp): Promise<void> {
  await clickHydrated(page.getByRole("button", { name: answer }));
}

test.describe("admin /admin/blocks", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation"); // live offering + owned days + 2 booked trips on Brew 3
  });

  test("a closure: what's happening first, how many came off, then Unblock asks first", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/blocks");

    await expect(
      page.getByText(
        "Nothing blocked. Take a boat out of service, close a dock for part of a day, or hold one departure on the calendar.",
      ),
    ).toBeVisible();
    // The question comes first: no fields until it is answered.
    await expect(page.getByText("What’s happening?")).toBeVisible();
    await expect(page.getByLabel("Which location")).toHaveCount(0);

    await choose(page, CLOSURE);
    await page.getByLabel("Which location").selectOption({ label: "Reservation Demo Dock" });
    await page.getByLabel("Date", { exact: true }).fill(DEMO.locationBlockWindow.date);
    await page.getByLabel("From", { exact: true }).fill("13:00");
    await page.getByLabel("To", { exact: true }).fill("16:00");
    await page.getByRole("button", { name: "Block it", exact: true }).click();
    await page.waitForURL(/sel=/);

    // The row in the list's own words, and the count the confirmation repeats.
    const row = page.getByTestId("block-row").filter({ hasText: "Reservation Demo Dock" });
    await expect(row).toContainText("Closed");
    const offSale = Number(await row.getByTestId("off-sale").textContent().then((t) => t?.match(/\d+/)?.[0]));
    expect(offSale).toBeGreaterThan(0);
    await expect(page.getByTestId("blocked-notice")).toHaveText(
      `Blocked. ${offSale} ${offSale === 1 ? "departure is" : "departures are"} off the calendar.`,
    );
    await expect(page.getByText(/1 booked \(\$549\) conflict/)).toBeVisible();

    // The chips say what they hold.
    await page.getByRole("link", { name: "Boats out", exact: true }).click();
    await expect(page.getByTestId("block-row")).toHaveCount(0);
    await page.getByRole("link", { name: "Closures", exact: true }).click();
    await expect(page.getByTestId("block-row")).toHaveCount(1);
    await page.getByRole("link", { name: "All", exact: true }).click();

    // Unblock asks first, and Keep blocked writes nothing.
    await page.getByTestId("block-row").click();
    await clickHydrated(page.getByRole("button", { name: "Unblock", exact: true }));
    const departures = offSale === 1 ? "this departure" : `these ${offSale} departures`;
    await expect(page.getByText(`Put ${departures} back on sale?`)).toBeVisible();
    await page.getByRole("button", { name: "Keep blocked", exact: true }).click();
    await expect(page.getByText(`Put ${departures} back on sale?`)).toHaveCount(0);
    await expect(page.getByTestId("block-row")).toHaveCount(1);

    await clickHydrated(page.getByRole("button", { name: "Unblock", exact: true }));
    await page.getByTestId("unblock-confirm").getByRole("button", { name: "Unblock", exact: true }).click();
    await page.waitForURL((url) => !url.searchParams.has("sel"));
    await expect(page.getByTestId("block-row")).toHaveCount(0);
  });

  test("a boat out: To left blank is the one day, and the list says Boat out", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/blocks");

    await choose(page, BOAT_OUT);
    await page.getByLabel("Which boat").selectOption({ label: DEMO.vesselName });
    await page.getByLabel("From", { exact: true }).fill(DEMO.vesselBlockWindow.start);
    await page.getByRole("button", { name: "Block it", exact: true }).click();
    await page.waitForURL(/sel=/);

    const row = page.getByTestId("block-row");
    await expect(row).toContainText("Boat out");
    await expect(row).toContainText(DEMO.vesselName);
    // Saved as a one-day block: the editor reloads it with To = From.
    await expect(page.getByLabel(/^To/)).toHaveValue(DEMO.vesselBlockWindow.start);
  });

  /**
   * Issue #1090's bug: a refused boat-out came back as the other form, because the editor's
   * choice was seeded from the selected block only and never from the refused draft.
   */
  test("a refused boat-out comes back as a boat-out, with what was typed", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/blocks");

    await choose(page, BOAT_OUT);
    await page.getByLabel("From", { exact: true }).fill(DEMO.vesselBlockWindow.start);
    await page.getByLabel("Reason").fill("engine service");
    await page.getByRole("button", { name: "Block it", exact: true }).click(); // no boat picked

    await expect(page.getByText("Pick a boat that’s still in the fleet.")).toBeVisible();
    await expect(page.getByLabel("Which boat")).toBeVisible();
    await expect(page.getByLabel("From", { exact: true })).toHaveValue(DEMO.vesselBlockWindow.start);
    await expect(page.getByLabel("Reason")).toHaveValue("engine service");
  });

  test("Cancel drops a new block; one departure points at the calendar; + New block from an edit", async ({
    page,
  }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/blocks");

    await choose(page, CLOSURE);
    await expect(page.getByLabel("Which location")).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByLabel("Which location")).toHaveCount(0);
    await expect(page.getByRole("button", { name: BOAT_OUT })).toBeVisible();

    await choose(page, ONE_DEPARTURE);
    await expect(page.getByRole("link", { name: "Pick the departure on the calendar →" })).toHaveAttribute(
      "href",
      "/admin/calendar",
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    // From an existing block, + New block is how you start another.
    await choose(page, BOAT_OUT);
    await page.getByLabel("Which boat").selectOption({ label: DEMO.vesselName });
    await page.getByLabel("From", { exact: true }).fill(DEMO.vesselBlockWindow.start);
    await page.getByRole("button", { name: "Block it", exact: true }).click();
    await page.waitForURL(/sel=/);
    await page.getByRole("link", { name: "+ New block" }).click();
    await page.waitForURL((url) => !url.searchParams.has("sel"));
    await expect(page.getByRole("button", { name: CLOSURE })).toBeVisible();
  });
});
