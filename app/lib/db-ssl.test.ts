import { describe, expect, it } from "vitest";
import tls from "node:tls";
import { CRUNCHY_TEAM_CA, sslConfigFor } from "./db-ssl";

/**
 * The TLS half of the Neon → Crunchy Bridge move (issue #960).
 *
 * Two properties, and the second is the one that lets the cutover be two
 * independent steps instead of one atomic one:
 *
 *  1. Verification is never disabled. `rejectUnauthorized: false` is the shortcut
 *     that makes a private-CA error go away while leaving you encrypted to an
 *     unknown peer — the acceptance criteria on #960 name it explicitly.
 *  2. Crunchy's CA is APPENDED to node's default roots, never substituted.
 *     `ssl: { ca }` replaces the trust store outright, so a build carrying only
 *     Crunchy's CA cannot talk to Neon. Appending means one build works against
 *     both, and `DATABASE_URL` can be swapped before or after the deploy.
 */
describe("sslConfigFor", () => {
  const LOCAL = "postgres://muster:muster@localhost:5432/muster_dev";
  const CRUNCHY = "postgres://application:pw@p.example.db.postgresbridge.com:5432/postgres?sslmode=verify-full";
  const NEON = "postgres://user:pw@ep-x.us-east-1.aws.neon.tech/neondb?sslmode=require";

  it("leaves a plain local URL alone, so dev Postgres without TLS still connects", () => {
    expect(sslConfigFor(LOCAL)).toBeUndefined();
  });

  it("leaves `sslmode=disable` alone", () => {
    expect(sslConfigFor(`${LOCAL}?sslmode=disable`)).toBeUndefined();
  });

  it("verifies against a TLS URL rather than trusting whatever answers", () => {
    const cfg = sslConfigFor(CRUNCHY);
    expect(cfg?.rejectUnauthorized).toBe(true);
  });

  it("APPENDS Crunchy's CA to node's defaults — the same build must reach Neon too", () => {
    const cfg = sslConfigFor(CRUNCHY);
    expect(cfg?.ca).toContain(CRUNCHY_TEAM_CA);
    // Substituting rather than appending is the bug this pins: the count must
    // exceed node's own root list, not equal one.
    expect(cfg?.ca?.length).toBe(tls.rootCertificates.length + 1);
  });

  it("hands Neon the same config, which is what makes the cutover non-atomic", () => {
    expect(sslConfigFor(NEON)).toEqual(sslConfigFor(CRUNCHY));
  });

  it("never disables verification, for any input", () => {
    for (const url of [LOCAL, CRUNCHY, NEON, `${LOCAL}?sslmode=require`, "not a url"]) {
      expect(sslConfigFor(url)?.rejectUnauthorized).not.toBe(false);
    }
  });

  it("carries a real certificate, not a placeholder", () => {
    expect(CRUNCHY_TEAM_CA).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(CRUNCHY_TEAM_CA.trimEnd()).toMatch(/-----END CERTIFICATE-----$/);
  });
});
