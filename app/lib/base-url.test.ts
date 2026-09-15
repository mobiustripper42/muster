import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appBaseUrl } from "./base-url";

/**
 * One answer to an unset `APP_BASE_URL` (#1007).
 *
 * **Why this file exists.** Six sites each answered "what if `APP_BASE_URL` is not set" for
 * themselves and got five different answers: one threw, two fell back to localhost, one skipped
 * the send and logged, one skipped and reported `not_configured`, one disabled SMS and let email
 * go. The same disease as #955 in the same three files, different variable.
 *
 * **The environment the issue missed.** Unset is not a misconfiguration — it is the DESIGNED
 * state on a preview deploy. `APP_BASE_URL` is scoped to Production only (DEC-057) so a preview's
 * minted links resolve to the preview rather than to prod, which is what makes `crew/dev-link`
 * worth having. So there are three environments here, not two, and the branch that had no
 * implementation at all is the preview one.
 */

/**
 * `vi.stubEnv` rather than assigning `process.env` directly, which `app/lib/sms.test.ts` does.
 * `NODE_ENV` is typed read-only under `tsconfig.json` (Next's ambient types), so a bare
 * assignment fails `typecheck:app` even though the same line compiles in `src/` — and `NODE_ENV`
 * is exactly the variable these cases have to move, since it is half of `isProdDeploy`.
 */
const VARS = ["APP_BASE_URL", "VERCEL_ENV", "VERCEL_URL", "NODE_ENV"] as const;

beforeEach(() => {
  for (const v of VARS) vi.stubEnv(v, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("appBaseUrl — one answer, three environments (#1007)", () => {
  it("a configured value wins in every environment, trailing slashes stripped", () => {
    vi.stubEnv("APP_BASE_URL", "https://muster.example.com///");
    vi.stubEnv("VERCEL_ENV", "production");

    expect(appBaseUrl()).toBe("https://muster.example.com");
  });

  it("returns the preview's OWN origin on a preview deploy, where unset is by design", () => {
    // The branch nothing implements today, and the reason this is more than a tidy-up.
    // `forwardBoardAlerts` keys its throw on `NODE_ENV === "production"`, which Vercel sets on
    // previews too — the exact wrong predicate `src/config/deploy.ts:22-26` exists to name. So
    // the At-Risk alert throws on every preview, in the one environment where DEC-057 says the
    // variable is SUPPOSED to be missing.
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_URL", "muster-abc123.vercel.app");

    expect(appBaseUrl()).toBe("https://muster-abc123.vercel.app");
  });

  it("falls back to localhost in local dev, with nothing set", () => {
    expect(appBaseUrl()).toBe("http://localhost:3000");
  });

  it("throws on a Vercel production deploy with the variable unset", () => {
    // A prod deploy that cannot build a correct link is broken, not degraded: every one of the
    // six callers exists to DELIVER a link, and `env.example:12-14` says the cron has no Host
    // header to fall back on. Loud beats five quiet degradations.
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");

    expect(() => appBaseUrl()).toThrow(/APP_BASE_URL/);
  });

  it("throws on a self-hosted prod deploy too — the other door to isProdDeploy", () => {
    // `VERCEL_ENV` absent + `NODE_ENV=production` is `next start` / Docker. `deploy.ts` treats
    // it as the same answer, and a test for only the Vercel shape would miss a whole host class.
    vi.stubEnv("NODE_ENV", "production");

    expect(() => appBaseUrl()).toThrow(/APP_BASE_URL/);
  });

  it("prefers a configured value over VERCEL_URL — a preview MAY set its own", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_URL", "muster-abc123.vercel.app");
    vi.stubEnv("APP_BASE_URL", "https://staging.muster.example.com");

    expect(appBaseUrl()).toBe("https://staging.muster.example.com");
  });
});
