/**
 * Run one engine tick against dev Postgres (DEC-023 — no scheduler in v1, so
 * the clock op is explicit; a hosted cron takes over at first deploy). Dev
 * tooling, not app code: this is how you advance shifts / fire Tier-1 / stall
 * into Tier-2 / record board landings by hand.
 *
 *   npm run db:tick
 *
 * Reads the real clock (the one place outside tests that does — the core
 * itself stays clock-free, `now` is injected here).
 *
 * This script is also tick's CHANNEL EDGE (DEC-030): the asks tick fires are
 * surfaced on its result and forwarded to the web-link adapter here — one
 * line, exactly like the app actions. Links are built on APP_BASE_URL
 * (defaulting to the Tailscale dev host so a texted link works from a phone).
 */
import { tick } from "../src/builder/tick.js";
import { forwardAsks } from "../src/adapters/forward-asks.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { LogChannel } from "../src/adapters/log-channel.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);
// No Twilio wiring here on purpose — this script exists to WATCH the engine, and the
// log line is what you read. `db/` is in neither tsconfig's `include` and has no test,
// so nothing in `npm run verify` would have caught this import going stale (the
// `xola-report.ts` incident in DEC-159, exactly repeated).
const channel = new LogChannel(repo, {
  linkBase: process.env.APP_BASE_URL ?? "http://mill-dev:3000",
  sink: (line) => console.log(line),
});

try {
  const now = new Date();
  const r = await tick(repo, now);
  // Edge channel wiring: every ask this tick fired → Twilio, or the log line that
  // replaced the outbox when no key is configured (#934).
  const forwarded = await forwardAsks(repo, channel, r.firedAsks);
  console.log(`tick @ ${now.toISOString()}`);
  console.log(`  shiftsAdvanced:  ${r.shiftsAdvanced}`);
  console.log(`  bornFilling:     ${r.bornFilling}`);
  console.log(`  toAtRisk:        ${r.toAtRisk}`);
  console.log(`  shiftsCompleted: ${r.shiftsCompleted}   (trips that ran, crew still aboard — #570)`);
  console.log(`  asksFired:       ${r.asksFired}   (Tier-1 broadcasts)`);
  console.log(`  shiftsEscalated: ${r.shiftsEscalated}   (Tier-2 stalls worked)`);
  console.log(`  nudgesFired:     ${r.nudgesFired}   (Tier-2 direct nudges)`);
  console.log(`  boardLanded:     ${r.boardLanded}   (new (shift,reason) board landings — DEC-026)`);
  console.log(`  asksRelayed:     ${forwarded}   (texted, or logged when Twilio is unconfigured)`);
} finally {
  await repo.close();
}
