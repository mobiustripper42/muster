import pg from "pg";
import { PostgresRepository } from "@core/adapters/postgres-repository.js";

/**
 * App-side repository access (DEC-020, DEC-DATA-1). The app talks to the domain
 * only through the same `Repository` port the tests use — Postgres in the app,
 * the in-memory double in tests. One pool for the process, cached on globalThis
 * so Next's dev hot-reload doesn't leak a new pool per reload.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://muster:muster@localhost:5432/muster_dev";

const g = globalThis as unknown as { __musterPool?: pg.Pool };
const pool = (g.__musterPool ??= new pg.Pool({
  connectionString: DATABASE_URL,
  connectionTimeoutMillis: 2000,
}));

export function getRepo(): PostgresRepository {
  return new PostgresRepository(pool);
}
