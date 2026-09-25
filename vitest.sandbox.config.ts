import { defineConfig } from "vitest/config";
import base from "./vitest.config";

/**
 * `npm run test:stripe` — the suites that call a real provider sandbox (issue #1021).
 *
 * Kept out of the default run by suffix: `vitest.config.ts` includes `*.test.ts`, and these are
 * `*.sandbox.ts`. They need the network and test keys, and they create objects in the provider's
 * account every run, so they are run on purpose, never by `verify`.
 *
 * A spread rather than `mergeConfig`, which CONCATENATES arrays: merged, `include` would be the
 * whole default suite plus this one.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["src/**/*.sandbox.ts"],
    // Several real API round trips plus event polling per case.
    testTimeout: 60_000,
  },
});
