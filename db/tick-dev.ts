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
import { WebLinkChannel } from "../src/adapters/web-link-channel.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);
const channel = new WebLinkChannel(repo, {
  linkBase: process.env.APP_BASE_URL ?? "http://mill-dev:3000",
});

try {
  const now = new Date();
  const r = await tick(repo, now);
  // Edge channel wiring (DEC-030): every ask this tick fired → the pilot outbox.
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
  console.log(`  outboxQueued:    ${forwarded}   (relays queued for /admin/outbox — DEC-030)`);
} finally {
  await repo.close();
}
