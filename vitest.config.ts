import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // `db/**` joined the include when db:reset:dev landed: its target guard decides whether a
    // destructive script runs, which is exactly the kind of thing that must be tested.
    // `scripts/**` joined for the same reason as `db/**`: check-decisions.mjs decides
    // whether the build passes (#564), and a guard nobody tests is a guard nobody trusts.
    include: ["src/**/*.test.ts", "app/**/*.test.ts", "db/**/*.test.ts", "scripts/**/*.test.mjs"],
    env: {
      // Civil send window (DEC-088) held WIDE OPEN for the suite: the tests'
      // clocks are arbitrary UTC instants, and the gate is orthogonal to what
      // they assert. The gate itself is tested with explicitly injected
      // windows (tick.test.ts / ask-loop civil cases).
      CIVIL_SEND_START: "00:00",
      CIVIL_SEND_END: "23:59", // NB half-open: 23:59:00–:59 is OUTSIDE — HH:MM bounds can't close the last minute; avoid 23:59 test clocks
    },
  },
});
