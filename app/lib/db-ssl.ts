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

/**
 * `undefined` means "leave `pg` alone" — local dev talks to a plain Postgres with no
 * TLS at all, and forcing an `ssl` object there breaks the connection outright.
 *
 * Everything else gets node's default roots **plus** Crunchy's, never Crunchy's
 * instead of node's. `ssl: { ca }` *replaces* the trust store, so substituting would
 * make this build unable to reach Neon — and the whole point is that one build talks
 * to both, so `DATABASE_URL` can be swapped independently of the deploy rather than
 * in lockstep with it.
 */
export function sslConfigFor(connectionString: string): DbSslConfig | undefined {
  const sslmode = /[?&]sslmode=([^&]+)/.exec(connectionString)?.[1];
  if (sslmode === undefined || sslmode === "disable") return undefined;
  return {
    ca: [...tls.rootCertificates, CRUNCHY_TEAM_CA],
    rejectUnauthorized: true,
  };
}
