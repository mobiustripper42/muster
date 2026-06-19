/**
 * e2e harness fixtures (#65) — the three things every spec needs: a deterministic
 * DB state, a signed-in crew session, a signed-in operator session.
 *
 * Seed strategy (DEC at task #65): the dev seeds are CLI scripts, not exported
 * functions. Rather than refactor three working scripts, we spawn them with
 * DATABASE_URL pointed at the test DB. Heavier than an in-process call, but the
 * scripts stay untouched and the harness reuses the exact states the manual
 * walkthrough (RUNNING.md) already documents.
 */
import { execFileSync } from "node:child_process";
import { test as base, expect, type Page } from "@playwright/test";
import { resetTestDb, TEST_DATABASE_URL } from "../db/reset-test.js";

/** Local tsx binary — resolved explicitly so we don't depend on PATH/npx. */
const TSX = "node_modules/.bin/tsx";

const SEED_SCRIPTS = {
  crew: "db/seed-crewapp-dev.ts",
  atrisk: "db/seed-atrisk-dev.ts",
  outbox: "db/seed-outbox-dev.ts",
} as const;

type SeedName = keyof typeof SEED_SCRIPTS;

/** Truncate the test DB, then run the named dev seeds against it, in order. */
export async function resetAndSeed(...seeds: SeedName[]): Promise<void> {
  await resetTestDb();
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
