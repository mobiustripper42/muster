import pg from "pg";
import { PostgresRepository } from "@core/adapters/postgres-repository.js";
import { PostgresPresence } from "@core/adapters/postgres-presence.js";
import { sslConfigFor } from "./db-ssl";

/**
 * App-side repository access (DEC-020, DEC-DATA-1). The app talks to the domain
 * only through the same `Repository` port the tests use — Postgres in the app,
 * the in-memory double in tests. One pool for the process, cached on globalThis
 * so Next's dev hot-reload (and a warm Vercel function instance) reuses it
 * instead of leaking a new pool.
 *
 * Serverless tuning (DEC-033): on Vercel, `DATABASE_URL` is the host's **pooled**
 * endpoint (PgBouncer fans many warm instances into the DB), so keep this
 * per-instance pool small. The connection timeout is generous enough to absorb a
 * scale-to-zero cold start (~sub-second) on the first request after idle.
 *
 * `ssl` is set explicitly rather than inferred from `sslmode` in the URL (#960).
 * node-postgres has historically read `sslmode=require` as *encrypt but do not
 * verify*, which is an encrypted channel to an unidentified peer — see `db-ssl.ts`
 * for why the trust list is node's defaults **plus** Crunchy's CA rather than
 * Crunchy's alone.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://muster:muster@localhost:5432/muster_dev";

const g = globalThis as unknown as { __musterPool?: pg.Pool };
const pool = (g.__musterPool ??= new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: sslConfigFor(DATABASE_URL),
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
}));

export function getRepo(): PostgresRepository {
  return new PostgresRepository(pool);
}

/**
 * App-side presence access (#112, DEC-047). The `PresencePort` behind the shared
 * pool — separate from the `Repository` so the realtime swap (DEC-047) is a
 * one-adapter change that never touches persistence.
 */
export function getPresence(): PostgresPresence {
  return new PostgresPresence(pool);
}
