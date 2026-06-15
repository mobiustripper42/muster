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
import { DEFAULT_DATABASE_URL } from "./migrate.js";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
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
const subjectId = (admin ?? crew)!;

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);

try {
  const now = new Date();
  const { token, secret } = await issueMagicLink(
    repo,
    { subjectKind, subjectId, ttlMs: ttlMin * 60_000 },
    { now, mintSecret: randomSecret },
  );
  const link = `${base}/crew/auth?t=${secret}`;
  console.log(`Minted ${subjectKind} link · ${subjectId}`);
  console.log(`  ${link}`);
  console.log(`  single-use · expires ${token.expiresAt} (${ttlMin} min)`);
} finally {
  await repo.close();
}
