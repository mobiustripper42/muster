/**
 * e2e harness fixtures (#65) — the three things every spec needs: a deterministic
 * DB state, a signed-in crew session, a signed-in operator session.
 *
 * Seed strategy (DEC at task #65): spawn each dev seed as a subprocess with
 * DATABASE_URL pointed at the test DB, so the harness reuses the exact states
 * the manual walkthrough (RUNNING.md) documents.
 *
 * The seeds DO export functions now (they are `seedX(repo)` so `db:all`
 * could call them in-process), so the original "they're CLI-only" reason is
 * gone. The spawn stays anyway, deliberately: it keeps each seed's DATABASE_URL
 * scoped to one child process, so nothing in the harness can import a seed and
 * have it touch `muster_dev` through an ambient default. Heavier than an
 * in-process call; the isolation is worth it here.
 */
import { execFileSync } from "node:child_process";
import { test as base, expect, type Page } from "@playwright/test";
import { resetTestDb, TEST_DATABASE_URL } from "../db/reset-test.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";

/** Local tsx binary — resolved explicitly so we don't depend on PATH/npx. */
const TSX = "node_modules/.bin/tsx";

const SEED_SCRIPTS = {
  crew: "db/seed-crewapp-dev.ts",
  atrisk: "db/seed-atrisk-dev.ts",
  outbox: "db/seed-outbox-dev.ts",
} as const;

type SeedName = keyof typeof SEED_SCRIPTS;

/**
 * The e2e operator: a seeded admin whose short handle is `spink` — what every
 * `signInAsAdmin(page, "spink")` resolves through the dev-link handle→id lookup
 * (DEC-092). Its id is the operator crew id (`crew-spink`, = OPERATOR_CREW_MEMBER_ID).
 * `resetTestDb` truncates `admins` (dynamic all-tables wipe), so we re-seed it on
 * every reset. Nothing else seeds that table — migration 0019 dropped the
 * provisional roster 0018 inserted, and admins have been CLI-managed since
 * (DEC-092) — so this synthetic operator is the only admin e2e ever sees.
 */
async function seedAdmin(a: {
  id: string;
  handle: string;
  name?: string;
  active?: boolean;
}): Promise<void> {
  const active = a.active ?? true;
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    await repo.saveAdmin({
      id: a.id,
      handle: a.handle,
      name: a.name ?? a.handle,
      active,
      createdAt: "2026-07-06T00:00:00.000Z",
      deactivatedAt: active ? null : "2026-07-06T09:00:00.000Z",
    });
  } finally {
    await repo.close();
  }
}

/** Seed an extra admin (e.g. a second operator for the per-person-revoke test). */
export async function seedExtraAdmin(
  a: { id: string; handle: string; name?: string; active?: boolean },
): Promise<void> {
  await seedAdmin(a);
}

/** Flip an admin's `active` flag — the per-person revoke lever (DEC-092). */
export async function setAdminActive(handle: string, active: boolean): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    const a = await repo.getAdminByHandle(handle);
    if (!a) throw new Error(`no admin with handle "${handle}"`);
    await repo.saveAdmin({
      ...a,
      active,
      deactivatedAt: active ? null : "2026-07-06T09:00:00.000Z",
    });
  } finally {
    await repo.close();
  }
}

/** Truncate the test DB, seed the operator admin, then run the named dev seeds. */
export async function resetAndSeed(...seeds: SeedName[]): Promise<void> {
  await resetTestDb();
  await seedAdmin({ id: "crew-spink", handle: "spink", name: "Spink" });
  for (const name of seeds) {
    execFileSync(TSX, [SEED_SCRIPTS[name]], {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: "pipe",
    });
  }
}

/** Drive the real dev-link sign-in (the button POSTs straight to /crew/auth). */
export async function signInAsCrew(page: Page, crewId: string): Promise<void> {
  await page.goto(`/crew/dev-link?crew=${encodeURIComponent(crewId)}`);
  await page.getByRole("button", { name: /tap to sign in/i }).click();
  // Success lands on a clean /crew; a FAILED consume lands on /crew?auth=<reason>.
  // Exclude the failure param so a broken sign-in fails here, loudly, not later.
  await page.waitForURL((u) => u.pathname === "/crew" && !u.searchParams.has("auth"));
}

/** Same flow, operator subject — lands on the at-risk board. */
export async function signInAsAdmin(page: Page, handle: string): Promise<void> {
  await page.goto(`/crew/dev-link?admin=${encodeURIComponent(handle)}`);
  await page.getByRole("button", { name: /tap to sign in/i }).click();
  await page.waitForURL(/\/admin\/at-risk/);
}

export const test = base;
export { expect };
