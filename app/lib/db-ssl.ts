import tls from "node:tls";

/**
 * TLS trust for the database connection (issue #960 — Neon → Crunchy Bridge).
 *
 * **This certificate is public and belongs in the repo.** A CA certificate carries
 * only a public key; the matching private key never leaves Crunchy. Publishing it
 * grants nobody anything. What authenticates *us* to the server is the password in
 * `DATABASE_URL`, which is a secret and is not here.
 *
 * Crunchy issues each team its own self-signed root — `CN` is the team id, and this
 * one matches the team that owns the production cluster. It is in nobody's default
 * trust store, so without it node reports `self-signed certificate in certificate
 * chain` and refuses. Neon's certificate, by contrast, chains to a public root that
 * ships inside node, which is why nothing like this file was ever needed before.
 *
 * A committed constant rather than an env var, deliberately: an env var that someone
 * forgets to set fails at *connection* time, in production, on the deploy that was
 * supposed to be uneventful. This cannot be forgotten and cannot drift, and the cert
 * runs to 2046.
 */
export const CRUNCHY_TEAM_CA = `-----BEGIN CERTIFICATE-----
MIIBpTCCAUqgAwIBAgIJAOfdeCniJVywMAoGCCqGSM49BAMDMCUxIzAhBgNVBAMM
GnhuNGNkb3ZidG5mc2xwZnZzYWN1Z2ZiM2p1MB4XDTI2MDkwOTIzNDQ0MloXDTQ2
MDkwNDIzNDQ0MlowJTEjMCEGA1UEAwwaeG40Y2RvdmJ0bmZzbHBmdnNhY3VnZmIz
anUwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQrmZT6lmtMu5UH8itOCXVhsgeo
lofr8pCLc9B4IxwsQ4FBW3Smevh+CVhHfxY8rV7xLw2r4STIpN15jpbDzbDno2Mw
YTAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAdBgNVHQ4EFgQUKVaj
3E2Escdog1t/FddQsjmSnz4wHwYDVR0jBBgwFoAUKVaj3E2Escdog1t/FddQsjmS
nz4wCgYIKoZIzj0EAwMDSQAwRgIhALbUiUmXmVkBTXovUInZTay2H1rO4JssOK+I
VGeEZi5rAiEA0pCDFtdu+vqSvSk7tERO/X+/qpnl+scPffmN0ooeG6s=
-----END CERTIFICATE-----
`;

/** What `pg` accepts for `ssl`; a subset of node's TLS options is all we set. */
export type DbSslConfig = { ca: string[]; rejectUnauthorized: true };

/** Hosts that run a plain, TLS-less Postgres — the dev box, and nothing else. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * libpq ssl parameters. These must be **removed** from the connection string, not
 * merely ignored: `pg` parses the connection string and merges the result OVER the
 * caller's config (`pg/lib/connection-parameters.js`), and `pg-connection-string`
 * sets `ssl` whenever `sslmode` is present. Leaving one in means the string wins and
 * our `ca` never reaches the handshake — silently, with a green test suite.
 */
const SSL_PARAMS = ["sslmode", "sslrootcert", "sslcert", "sslkey", "sslpassword", "ssl"];

const TRUST: DbSslConfig = {
  // APPENDED to node's defaults, never substituted. `ssl: { ca }` replaces the trust
  // store outright, so substituting would make this build unable to reach Neon — and
  // the point is that one build talks to both, so `DATABASE_URL` can be swapped
  // independently of the deploy rather than in lockstep with it.
  ca: [...tls.rootCertificates, CRUNCHY_TEAM_CA],
  rejectUnauthorized: true,
};

/**
 * Build the `pg` client/pool config for a database URL: the connection string with
 * every ssl parameter stripped, plus an explicit `ssl` that therefore survives.
 *
 * **TLS is decided by the host, not by `sslmode`.** The first cut keyed on the
 * presence of an `sslmode` parameter, which fails open twice over: the real Crunchy
 * connection string carries no `sslmode` at all and would have been read as "local
 * dev, no TLS", and a string carrying `sslmode=no-verify` would have handed `pg`
 * `rejectUnauthorized: false` — an encrypted channel to an unidentified peer.
 *
 * A URL that cannot be parsed **requires** TLS rather than skipping it. The safe
 * value is the one you get by being wrong.
 */
export function pgConnectionConfig(url: string): {
  connectionString: string;
  ssl?: DbSslConfig;
} {
  let parsed: URL;
  try {
    parsed = new URL(url);
    // NON-fault, and deliberately silent (#854 exception): the only thing this catch
    // could log is the malformed value, and that value is a connection string with a
    // password in it. The failure is not discarded — it is handled, by requiring TLS.
    // eslint-disable-next-line no-restricted-syntax -- logging the cause would log the credential
  } catch {
    return { connectionString: url, ssl: TRUST };
  }

  const sslmode = parsed.searchParams.get("sslmode");
  for (const p of SSL_PARAMS) parsed.searchParams.delete(p);
  const connectionString = parsed.toString();

  // Local Postgres speaks no TLS; handing it an `ssl` object breaks the connection.
  // `sslmode=disable` is the explicit escape hatch for a non-local plain server.
  const plain = LOCAL_HOSTS.has(parsed.hostname) || sslmode === "disable";
  return plain ? { connectionString } : { connectionString, ssl: TRUST };
}
