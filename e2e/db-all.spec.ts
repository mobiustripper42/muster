/**
 * `db:all` — the one command that gets a dev DB to a known-good state.
 * Two properties worth a black-box test, because both are things you only find
 * out are broken when you're already trying to work:
 *
 *   1. The whole registry runs end to end on a truly empty database. Any seed
 *      that depends on an earlier seed's rows breaks HERE, not on someone's
 *      machine three commits later.
 *   2. The operator can actually sign in afterwards. That's the point of the
 *      command, and it has a specific failure mode with no visible symptom: a
 *      crew record with no `email` can never receive a login code, and the
 *      no-enumeration design (DEC-081) shows the IDENTICAL "code is on its way"
 *      screen either way. It looks like it worked. This test reads the code
 *      back through the dev-code echo, so "looks like it worked" isn't enough.
 *
 * Runs the real `runAll` against the test DB (its localhost guard permits it) —
 * not a re-implementation of the registry, the registry itself.
 */
import { runAll } from "../db/all-dev.js";
import { TEST_DATABASE_URL } from "../db/reset-test.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { test, expect } from "./fixtures.js";

const ERIC_EMAIL = "eric@bb.test";

test.describe("db:all", () => {
  // One seed for the whole file — it truncates and re-seeds everything, so
  // per-test resets would just repeat several seconds of identical work.
  test.beforeAll(async () => {
    await runAll(TEST_DATABASE_URL, false);
  });

  test("promotes the operator's crew record to an active admin", async () => {
    const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
    try {
      const admin = await repo.getAdminByHandle("eric");
      expect(admin).toBeTruthy();
      expect(admin?.id).toBe("crew-eric");
      expect(admin?.active).toBe(true);
    } finally {
      await repo.close();
    }
  });

  test("the operator can complete the email → code → session round-trip", async ({
    page,
  }) => {
    await page.goto("/crew");
    await page.getByLabel(/sign in with your crew email/i).fill(ERIC_EMAIL);
    await page.getByRole("button", { name: /email me a code/i }).click();
    await expect(page.getByLabel(/enter your code/i)).toBeVisible();

    // The store keeps only the code's hash; the dev-only echo is the sole way to
    // read it back. A 204 here means NO code was ever minted — i.e. the roster
    // didn't match the email — which is exactly the silent failure this guards.
    const echo = await page.request.get(
      `/crew/dev-code?email=${encodeURIComponent(ERIC_EMAIL)}`,
    );
    expect(echo.status(), "no code minted for the operator's email").toBe(200);
    const code = (await echo.text()).trim();
    expect(code).toMatch(/^\d{6}$/);

    await page.getByLabel(/enter your code/i).fill(code);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    // Signed in ⇒ the sign-in form is gone from /crew.
    await expect(page.getByLabel(/sign in with your crew email/i)).toBeHidden();
  });
});
