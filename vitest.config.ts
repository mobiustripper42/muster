import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
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
