import { describe, expect, it, vi } from "vitest";
import tls from "node:tls";
import pg from "pg";
import { PostgresRepository } from "../adapters/postgres-repository.js";
import { CRUNCHY_TEAM_CA, pgConnectionConfig } from "./db-ssl.js";

/**
 * The TLS half of the Neon → Crunchy Bridge move (issue #960).
 *
 * **The integration block below is the load-bearing one, and it exists because the
 * unit tests alone were green while the shipped code did not work.** The first cut
 * of this file tested `sslConfigFor(url)` in isolation, asserted the CA was in the
 * returned object, and passed — but `repo.ts` handed that object to `pg` *alongside*
 * a `connectionString`, and `pg` merges the parsed connection string OVER the
 * caller's config (`pg/lib/connection-parameters.js`, then `pg-connection-string`
 * setting `ssl` whenever `sslmode` is present). The CA was dropped before the
 * handshake. Testing the helper is not testing the connection.
 *
 * Two failure directions, both fail-OPEN, which is why this is tested at all:
 *
 *  - a URL carrying `sslmode` overrides our `ssl` object — with `sslmode=no-verify`
 *    that is `rejectUnauthorized: false`, an encrypted channel to an unverified peer;
 *  - a URL carrying NO `sslmode` was previously read as "local dev, no TLS", which is
 *    exactly the shape of the real Crunchy string.
 */
const LOCAL = "postgres://muster:muster@localhost:5432/muster_dev";
const CRUNCHY = "postgres://application:pw@p.example.db.postgresbridge.com:5432/postgres";
const CRUNCHY_VERIFY = `${CRUNCHY}?sslmode=verify-full`;
const NEON = "postgres://user:pw@ep-x.us-east-1.aws.neon.tech/neondb?sslmode=require";
const NO_VERIFY = `${CRUNCHY}?sslmode=no-verify`;

/** What `pg` will actually use, built through its own public constructor. */
function sslAsPgSeesIt(url: string): unknown {
  const client = new pg.Client(pgConnectionConfig(url));
  return (client as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl;
}

describe("pgConnectionConfig — what reaches pg", () => {
  it("delivers the CA to the client for a Crunchy URL with no sslmode", () => {
    const ssl = sslAsPgSeesIt(CRUNCHY) as { ca?: string[] };
    expect(ssl.ca).toContain(CRUNCHY_TEAM_CA);
  });

  it("delivers the CA even when the URL carries sslmode, which pg would otherwise override", () => {
    const ssl = sslAsPgSeesIt(CRUNCHY_VERIFY) as { ca?: string[] };
    expect(ssl.ca).toContain(CRUNCHY_TEAM_CA);
  });

  it("keeps verification on for Neon, so one build reaches both databases", () => {
    const ssl = sslAsPgSeesIt(NEON) as { ca?: string[]; rejectUnauthorized?: boolean };
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.ca).toContain(CRUNCHY_TEAM_CA);
  });

  it("refuses to let `sslmode=no-verify` in a URL disable verification", () => {
    const ssl = sslAsPgSeesIt(NO_VERIFY) as { rejectUnauthorized?: boolean };
    expect(ssl.rejectUnauthorized).toBe(true);
  });

  it("leaves local dev on plain TCP — an ssl object there breaks the connection", () => {
    expect(sslAsPgSeesIt(LOCAL)).toBeFalsy();
  });
});

describe("pgConnectionConfig — the decision itself", () => {
  it("keys TLS on the host, not on the presence of an sslmode parameter", () => {
    // The real Crunchy string has no `sslmode`. Reading its absence as "local, no TLS"
    // is the fail-open this pins.
    expect(pgConnectionConfig(CRUNCHY).ssl).toBeDefined();
    expect(pgConnectionConfig(LOCAL).ssl).toBeUndefined();
  });

  it("strips ssl parameters from the connection string it hands pg", () => {
    expect(pgConnectionConfig(CRUNCHY_VERIFY).connectionString).not.toMatch(/sslmode/);
    expect(pgConnectionConfig(NO_VERIFY).connectionString).not.toMatch(/sslmode/);
  });

  it("preserves every non-ssl query parameter", () => {
    const { connectionString } = pgConnectionConfig(
      `${CRUNCHY}?sslmode=require&application_name=muster&connect_timeout=10`,
    );
    expect(connectionString).toMatch(/application_name=muster/);
    expect(connectionString).toMatch(/connect_timeout=10/);
  });

  it("honours an explicit sslmode=disable, for a non-local plain server", () => {
    expect(pgConnectionConfig(`${CRUNCHY}?sslmode=disable`).ssl).toBeUndefined();
  });

  it("fails CLOSED on an unparseable URL — TLS required, not skipped", () => {
    expect(pgConnectionConfig("not a url").ssl).toBeDefined();
  });

  it("APPENDS the CA to node's defaults rather than replacing them", () => {
    expect(pgConnectionConfig(CRUNCHY).ssl?.ca?.length).toBe(tls.rootCertificates.length + 1);
  });

  it("never disables verification, for any input", () => {
    for (const url of [LOCAL, CRUNCHY, CRUNCHY_VERIFY, NEON, NO_VERIFY, "not a url"]) {
      expect(pgConnectionConfig(url).ssl?.rejectUnauthorized).not.toBe(false);
    }
  });

  it("carries a real certificate, not a placeholder", () => {
    expect(CRUNCHY_TEAM_CA).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(CRUNCHY_TEAM_CA.trimEnd()).toMatch(/-----END CERTIFICATE-----$/);
  });
});

/**
 * The call site, not the helper — #968's own lesson applied to itself.
 *
 * Everything above proves `pgConnectionConfig` builds the right object. That was
 * ALREADY true before this change and production still refused every terminal
 * script, because seventeen callers never called it. So a green helper test is
 * exactly the evidence that was already there and was not enough.
 *
 * `fromConnectionString` is the one function all seventeen reach — `db:admin`,
 * `db:crew`, `db:pay`, `db:seed:fleet`, every seed, the e2e fixtures. `#pool` is a
 * true private field, so the pool cannot be read off the instance; spying on the
 * constructor is what lets us see what it was handed.
 */
describe("PostgresRepository.fromConnectionString — the call site 17 scripts use", () => {
  it("hands the pool the Crunchy CA, without the caller asking", () => {
    // A class, not an arrow: `fromConnectionString` calls `new pg.Pool(...)`, and
    // an arrow function is not a constructor.
    const spy = vi.spyOn(pg, "Pool").mockImplementation(
      class {
        async end(): Promise<void> {}
      } as unknown as typeof pg.Pool,
    );
    try {
      PostgresRepository.fromConnectionString(CRUNCHY);
      expect(spy).toHaveBeenCalledTimes(1);
      const config = spy.mock.calls[0]?.[0] as { ssl?: { ca?: string[] } };
      expect(config.ssl?.ca).toContain(CRUNCHY_TEAM_CA);
    } finally {
      spy.mockRestore();
    }
  });

  it("still hands a local pool NO ssl — every database test depends on this", () => {
    // A class, not an arrow: `fromConnectionString` calls `new pg.Pool(...)`, and
    // an arrow function is not a constructor.
    const spy = vi.spyOn(pg, "Pool").mockImplementation(
      class {
        async end(): Promise<void> {}
      } as unknown as typeof pg.Pool,
    );
    try {
      PostgresRepository.fromConnectionString(LOCAL);
      const config = spy.mock.calls[0]?.[0] as { ssl?: unknown };
      expect(config.ssl).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
