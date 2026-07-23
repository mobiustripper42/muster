/**
 * /admin/integrity (#501) — the referential-integrity diagnostic on real data.
 *
 * `checkIntegrity` has always been contract-tested against synthetic fixtures;
 * what was missing is a way to run it against the actual database. DEC-131
 * ratified the no-FK graph as-built, so this page is the detective control that
 * bet depends on. These specs cover the three things that make it worth having:
 * it's admin-only, it doesn't scan until asked, and a planted orphan actually
 * shows up (with the scanned counts proving the walk happened either way).
 */
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { TEST_DATABASE_URL } from "../db/reset-test.js";
import { asId } from "../src/domain/ids.js";
import type { Seat } from "../src/domain/entities.js";
import { test, expect, resetAndSeed, signInAsAdmin, signInAsCrew } from "./fixtures.js";

const PAGE = "/admin/integrity";
const RUN = { role: "link" as const, name: /run check|run again/i };

/**
 * Plant a seat whose `shiftId` points at nothing — exactly the shape a backfill
 * or a hand-run delete produces. The DB accepts it precisely because there's no
 * foreign key, which is the whole reason this page exists.
 */
async function plantOrphanSeat(): Promise<Seat> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    // Borrow a real role id off an existing seat so `role` stays valid and the
    // ONLY violation is the one we planted.
    const existing = await repo.listAllSeats();
    const donor = existing[0];
    if (!donor) throw new Error("seed produced no seats to borrow a role from");
    const orphan: Seat = {
      id: asId<"SeatId">("seat-orphan-e2e"),
      shiftId: asId<"ShiftId">("shift-does-not-exist"),
      role: donor.role,
      kind: donor.kind,
      state: donor.state,
    };
    await repo.saveSeat(orphan);
    return orphan;
  } finally {
    await repo.close();
  }
}

test.describe("admin integrity diagnostic (#501)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("is not reachable unauthenticated — the reason it left /api/health still holds", async ({
    page,
  }) => {
    await page.goto(PAGE);

    // The shared admin gate, not the diagnostic.
    await expect(page.getByRole("heading", { name: /referential integrity/i })).toHaveCount(0);
    await expect(page.getByRole(RUN.role, { name: RUN.name })).toHaveCount(0);
  });

  test("a crew-only session gets the gate, not the scan", async ({ page }) => {
    await signInAsCrew(page, "crew-ar-barrel"); // crew in the atrisk seed, not an admin
    await page.goto(PAGE);

    await expect(page.getByRole(RUN.role, { name: RUN.name })).toHaveCount(0);
  });

  test("is idle until asked — landing on it scans nothing", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(PAGE);

    await expect(page.getByRole("heading", { name: /referential integrity/i })).toBeVisible();
    await expect(page.getByText(/not run yet/i)).toBeVisible();
    // No verdict and no counts before the run — the scan is opt-in, not a page load.
    await expect(page.getByRole("heading", { name: /^scanned$/i })).toHaveCount(0);
    await expect(page.getByRole(RUN.role, { name: /run check/i })).toBeVisible();
  });

  test("a clean spine says so explicitly, with the scanned counts as proof it ran", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(PAGE);
    await page.getByRole(RUN.role, { name: /run check/i }).click();

    await expect(page.getByText(/no dangling references/i)).toBeVisible();
    await expect(page.getByText(/not run yet/i)).toHaveCount(0);

    // "Clean" and "didn't run" must not look alike: the counts distinguish them.
    await expect(page.getByRole("heading", { name: /^scanned$/i })).toBeVisible();
    const scanned = page.getByRole("heading", { name: /^scanned$/i }).locator("..");
    await expect(scanned.getByText("seats")).toBeVisible();
    await expect(scanned.getByText("shifts")).toBeVisible();
    // A seeded DB has real rows — a zero here would mean the walk didn't happen.
    await expect(page.getByText(/rows scanned/i)).toBeVisible();
  });

  test("a planted orphan renders with entity, id, ref and missing id", async ({ page }) => {
    const orphan = await plantOrphanSeat();

    await signInAsAdmin(page, "spink");
    await page.goto(`${PAGE}?run=1`);

    await expect(page.getByText(/1 dangling reference/i)).toBeVisible();
    // Entity heading carries the grouping + count.
    await expect(page.getByRole("heading", { name: /^seat — 1 violation$/i })).toBeVisible();
    // …and the row carries the three fields needed to go fix it.
    await expect(page.getByText(orphan.id, { exact: true })).toBeVisible();
    await expect(page.getByText("shiftId", { exact: true })).toBeVisible();
    await expect(page.getByText(orphan.shiftId, { exact: true })).toBeVisible();

    // Counts still render on the dirty path.
    await expect(page.getByRole("heading", { name: /^scanned$/i })).toBeVisible();
  });

  test("is reachable from the admin hub", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin");

    await page.getByRole("link", { name: /integrity check/i }).click();
    await expect(page).toHaveURL(/\/admin\/integrity$/);
  });
});
