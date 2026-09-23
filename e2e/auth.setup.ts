/**
 * Sign in ONCE per saved identity, through the real code door, and save the session
 * (`fixtures.ts` § Sign-in). Runs as the "setup" project every other project depends on.
 *
 * The `crew` seed is what gives `quint@bb.test` and `eric@bb.test` a crew row with an email, and
 * `resetAndSeed` always re-seeds `eric`'s admin row. Specs reset the database after this; the
 * sessions survive that (see `fixtures.ts` for why).
 */
import { test as setup } from "@playwright/test";
import {
  resetAndSeed,
  SAVED_IDENTITIES,
  signInWithCode,
  switchToAdminFromDrawer,
} from "./fixtures.js";

setup("sign in once per saved identity, through the code door", async ({ browser }) => {
  await resetAndSeed("crew");
  for (const who of SAVED_IDENTITIES) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await signInWithCode(page, who.email);
      if (who.asAdmin) await switchToAdminFromDrawer(page);
      await context.storageState({ path: who.file });
    } finally {
      await context.close();
    }
  }
});
