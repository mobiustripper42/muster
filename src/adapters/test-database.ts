/**
 * A test database of one suite's own (#1041).
 *
 * `muster_test` is shared: the Repository contract, the PresencePort contract, the
 * Playwright harness and CI all point at it, and **vitest runs test files in parallel.**
 * Two suites in one database is a race waiting for the first one that wipes a table the
 * other is using.
 *
 * That race existed and was invisible. The Repository contract truncated a hand-maintained
 * list of 37 tables out of 45, and `presence` happened to be one of the eight it missed —
 * so the presence suite was isolated by a gap nobody knew was there. Closing that gap in
 * #1031 turned the accident into a flake: the full suite went red once and green on the
 * re-run. A flake in a suite of 2681 gets re-run, not read.
 *
 * So a suite that owns tables asks for its own database rather than trusting a skip list
 * to keep holding. The Repository contract keeps `muster_test` — it is the one every other
 * tool already points at, and moving it would mean moving CI and the Playwright harness too.
 */

import pg from "pg";

/**
 * `<base>_<suffix>`, created if absent, with every migration applied. Returns the URL.
 *
 * `create database` cannot run inside a transaction and cannot target the database being
 * created, so this connects to the server's `postgres` database to issue it. No
 * `if not exists` — Postgres has none for `create database` — so a concurrent creator
 * losing the race is caught by its SQLSTATE and treated as success, which is what it is.
 */
export async function ensureTestDatabase(baseUrl: string, suffix: string): Promise<string> {
  const url = new URL(baseUrl);
  const base = url.pathname.replace(/^\//, "");
  const name = `${base}_${suffix}`;

  const admin = new URL(baseUrl);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 2000 });
  await client.connect();
  try {
    // Identifier, not a value, so it cannot be a bound parameter — which is what
    // `sonarjs/sql-queries` is objecting to, correctly in general and not here.
    //
    // `name` is `<database from the connection string>_<literal suffix from the call site>`.
    // Both halves are already trusted by this process: the connection string is the one it
    // is about to authenticate with, and the suffix is a string constant in a test file.
    // Nothing reaches this from input, and this module is test-only — it is imported by
    // `*.test.ts` and by nothing that ships.
    //
    // The quotes are not decoration: they keep a name that needs quoting working, and they
    // are why a hypothetical hostile suffix could not break out of the identifier without
    // also containing a quote.
    // eslint-disable-next-line sonarjs/sql-queries -- identifier, not a value; see above
    await client.query(`create database "${name}"`);
  } catch (e) {
    // 42P04 = duplicate_database. Anything else is a real failure and must not be eaten:
    // swallowing a permissions error here would surface as a confusing connect failure
    // several lines later, which is the shape #902 spent an evening removing.
    if ((e as { code?: string }).code !== "42P04") throw e;
  } finally {
    await client.end();
  }

  url.pathname = `/${name}`;
  return url.toString();
}
