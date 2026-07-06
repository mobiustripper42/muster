/**
 * Production auth path (5.2, DEC-034) — mint a single magic link against a live DB.
 *
 * The deployed app has no self-service sign-up and `/crew/dev-link` is hard-404 in
 * production (it must never issue links in prod). So the operator's FIRST sign-in
 * to a hosted instance is bootstrapped here: an out-of-band script the operator
 * runs against the prod DB, exactly like `db:migrate`. It mints one single-use,
 * time-bounded link and prints it; the operator opens it, taps "sign in", and
 * lands on /admin/at-risk with a session cookie. NO email/delivery provider
 * (DEC-034 rejected it) — the operator just runs this and copies the URL.
 *
 *   APP_BASE_URL=https://<domain> DATABASE_URL=<direct-string> \
 *     npm run db:mint -- --admin=spink
 *
 *   --admin=<handle>   mint an OPERATOR link (the point of 5.2)
 *   --crew=<crewId>    mint a CREW link (symmetry with dev-link; crew normally
 *                      get theirs via the DEC-030 relay — this is a manual escape)
 *   --ttl-min=<n>      minutes the link stays redeemable (default 60)
 *
 * Reads the real clock (like db:tick — the core stays clock-free, `now` injected).
 *
 * SECURITY: the link is built on APP_BASE_URL and we REFUSE to mint without it. A
 * CLI has no request Host header to fall back on (unlike app/lib/base-url.ts's
 * dev convenience), and printing a localhost / spoofable origin to the operator —
 * who will then trust and open it — is exactly the host-spoofing footgun that
 * module warns about. No safe default exists here, so fail fast.
 */
import { issueMagicLink, randomSecret } from "../src/auth/magic-link.js";
import type { AuthSubjectKind } from "../src/domain/entities.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { existsSync } from "node:fs";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

// Convenience: pull APP_BASE_URL / DATABASE_URL from .env.local if present, so the
// operator can run `npm run db:mint -- --admin=spink` without re-pasting env on the
// command line (the deploy flow's `vercel env pull` already writes .env.local).
// Inline env STILL WINS — snapshot what was set, then restore it after the load —
// so an explicit `DATABASE_URL=… npm run db:mint` overrides the file.
//
// CAVEAT (DEPLOY.md step 3): Neon marks its connection vars Sensitive, so
// `vercel env pull` returns DATABASE_URL **empty**. APP_BASE_URL (not sensitive)
// pulls fine; the operator pastes the direct/unpooled DB string into .env.local
// once (it's gitignored) or passes it inline. The `db:` line printed below shows
// which host the token actually landed in, so a silent localhost mis-target shows.
if (existsSync(".env.local")) {
  const inline = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  };
  process.loadEnvFile(".env.local");
  for (const [k, v] of Object.entries(inline)) if (v) process.env[k] = v;
}

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/** The host:port a connection string targets — so the operator can SEE where the
 *  token landed (Neon vs a stray localhost). Best-effort; never throws. */
function dbHost(connectionString: string): string {
  try {
    return new URL(connectionString).host || "(unknown)";
  } catch {
    return "(unparseable)";
  }
}

const admin = flag("admin");
const crew = flag("crew");
const ttlMin = Number(flag("ttl-min") ?? "60");

if ((admin && crew) || (!admin && !crew)) {
  console.error("Pass exactly one of --admin=<handle> or --crew=<crewMemberId>.");
  process.exit(1);
}
if (!Number.isFinite(ttlMin) || ttlMin <= 0) {
  console.error(`--ttl-min must be a positive number (got ${flag("ttl-min")}).`);
  process.exit(1);
}

const base = process.env.APP_BASE_URL?.replace(/\/+$/, "");
if (!base) {
  console.error(
    "APP_BASE_URL is required — set it to the real production origin\n" +
      "(e.g. APP_BASE_URL=https://muster.vercel.app). A link built on the wrong\n" +
      "origin is host-spoofable / unopenable; there is no safe fallback in a CLI.",
  );
  process.exit(1);
}

const subjectKind: AuthSubjectKind = admin ? "admin" : "crew";

// `||` not `??`: an empty DATABASE_URL (what Sensitive vars pull as) is "unset",
// not a valid connection string — fall to the local-dev default rather than
// handing pg a "" it would resolve against libpq's localhost env defaults.
const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);

try {
  // `--admin=<handle>` resolves to the admin's id (= a crew id) and REFUSES an
  // unknown or deactivated handle — you can't mint a link for a revoked admin
  // (DEC-092). Crew links pass the id straight through (unchanged).
  let subjectId: string;
  if (admin) {
    const record = await repo.getAdminByHandle(admin);
    if (!record || !record.active) {
      const known = (await repo.listAdmins())
        .filter((a) => a.active)
        .map((a) => a.handle)
        .join(", ");
      console.error(
        `No active admin with handle "${admin}".` +
          (known ? ` Active handles: ${known}.` : " No active admins seeded."),
      );
      await repo.close();
      process.exit(1);
    }
    subjectId = record.id;
  } else {
    subjectId = crew!;
  }

  const now = new Date();
  const { token, secret } = await issueMagicLink(
    repo,
    { subjectKind, subjectId, ttlMs: ttlMin * 60_000 },
    { now, mintSecret: randomSecret },
  );
  const link = `${base}/crew/auth?t=${secret}`;
  const who = admin ? `${subjectId} (${admin})` : subjectId;
  console.log(`Minted ${subjectKind} link · ${who}   (db: ${dbHost(url)})`);
  console.log(`  ${link}`);
  console.log(`  single-use · expires ${token.expiresAt} (${ttlMin} min)`);
} finally {
  await repo.close();
}
