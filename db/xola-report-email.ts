/**
 * `db:xola:report:email` — run the Xola passenger report and email it to the operators.
 *
 * TEMPORARY BY DESIGN. This exists to carry the operator from now until Muster reservations
 * takes over (go-live ~Sept 1 2026, season ends Oct 15). It is a cron wrapper, not
 * infrastructure: when the cutover lands (DEC-126), delete this file, its test, its npm
 * script, and the crontab line. Nothing else references it.
 *
 *   npm run db:xola:report:email               # send
 *   npm run db:xola:report:email -- --dry-run  # print subject + recipients + body, send nothing
 *
 * Env (all from `.env.local` on the box that runs the cron — NOT Vercel; this never runs in
 * the deployed app):
 *   XOLA_REPORT_TO   comma-separated recipients
 *   RESEND_API_KEY   same key the crew sign-in emails use
 *   XOLA_REPORT_FROM optional sender; defaults to the Resend onboarding sender
 *   plus XOLA_API_KEY / XOLA_SELLER_ID, which the report script itself reads
 *
 * **Why a wrapper and not an `--email` flag on the report.** `db/xola-report.ts` is 532 lines
 * of top-level await that already works against live Xola. Threading a send through it means
 * editing the proven thing to add the unproven thing. Spawning it instead leaves it untouched
 * and gets the failure handling for free: if the report dies, throws, or hangs, this still
 * sends — with the failure in the subject.
 *
 * **The one rule here: silence is never the signal.** An email goes out on every run —
 * flagged rows, no flagged rows, no rows at all, or a crash. An operator who learns that no
 * email means nothing to do will read a broken cron as a quiet morning. That is the same
 * passive-failure shape that produced a report row whose capacity check silently did not run.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** The report can sit on a slow Xola pull; past this it is a hung cron, not a slow morning. */
const TIMEOUT_MS = 5 * 60_000;

export interface RunOutcome {
  /** Did the report exit 0? The authority on success — never the scraped counts. */
  ok: boolean;
  /** Every reservation line pulled — proof the run actually saw data. */
  total: number;
  /** Boats carrying more than they hold. */
  over: number;
  /** Declared-but-unpaid guests — money to chase. */
  chase: number;
}

/**
 * The counts from the two sections that mean "do something today".
 *
 * Deliberately NOT the report's own `N flagged` total. That figure counts every row with any
 * flag, and on a normal morning ~90% of it is `EXTRA GUESTS, consistent and within capacity` —
 * guests who paid, on a boat that fits them, needing nothing. A subject reading "17 flagged of 49"
 * on a day with one payment to chase trains you to stop reading the subject.
 */
export function urgentCounts(stderr: string): { over: number; chase: number } {
  const count = (title: string): number => {
    const m = new RegExp(`${title}[^\\n]*— (\\d+):`).exec(stderr);
    return m ? Number(m[1]) : 0;
  };
  return { over: count("OVER CAPACITY"), chase: count("DECLARED ≠ PAID") };
}

/** `"a@x, b@y ,"` → `["a@x", "b@y"]`. Empty list means "refuse to send", never "send to nobody". */
export function parseRecipients(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The subject is the only part of this email that reaches a locked phone, so every state that
 * needs an operator's attention has to be legible in it.
 *
 * `ok` is read FIRST and independently of the counts. The report prints its summary line before
 * some of the work it does afterwards, so a run can crash having already emitted numbers that
 * parse cleanly — reporting those as a clean morning is precisely the lie this whole file exists
 * to prevent.
 */
export function subjectFor(o: RunOutcome): string {
  if (!o.ok) return "Xola daily — REPORT FAILED";
  if (o.total === 0) return "Xola daily — NO ROWS returned (check the window)";
  const parts: string[] = [];
  if (o.over > 0) parts.push(`${o.over} over capacity`);
  if (o.chase > 0) parts.push(`${o.chase} to chase`);
  if (parts.length === 0) return `Xola daily — nothing to act on, ${o.total} lines`;
  return `Xola daily — ${parts.join(", ")}`;
}

/**
 * The two sections the operator acts on first: a boat that is over capacity, and money that was
 * declared but not paid. The report prints its sections after ~20 lines of pull diagnostics, which
 * is the right order at a terminal and the wrong one in an email opened on a phone.
 *
 * Hoisted, not copied — a duplicated section reads as two findings.
 */
const URGENT = ["OVER CAPACITY", "DECLARED ≠ PAID"];

export function hoistSections(stderr: string): { hoisted: string; rest: string } {
  const lines = stderr.split("\n");
  const picked: string[][] = URGENT.map(() => []);
  const rest: string[] = [];

  let active = -1;
  for (const line of lines) {
    const startsUrgent = URGENT.findIndex((t) => line.startsWith(t));
    if (startsUrgent >= 0) {
      active = startsUrgent;
      picked[active]!.push(line);
      continue;
    }
    // A section runs until the next non-indented, non-empty line — the shape `section()` emits.
    if (active >= 0 && (line.startsWith("  ") || line === "")) {
      picked[active]!.push(line);
      continue;
    }
    active = -1;
    rest.push(line);
  }

  const hoisted = picked
    .filter((block) => block.length > 0)
    .map((block) => block.join("\n").trimEnd())
    .join("\n\n");

  return { hoisted: hoisted ? `${hoisted}\n` : "", rest: rest.join("\n") };
}

/**
 * How many LIVE trips escaped their capacity check.
 *
 * Not the same as the report's `N event(s) STILL have no boat` diagnostic, and the difference is
 * the whole point. That diagnostic counts events, and a cancelled trip's event is routinely gone
 * *because* it was cancelled — `db/xola-report.ts:404` therefore raises the row flag only when the
 * trip is neither cancelled nor self-captained. Counting the diagnostic put a ⚠ on three cancelled
 * trips on the first run of this wrapper. `stderr` is accepted but deliberately unused for the
 * count: it is here so nobody re-reaches for it.
 */
export function countUnaudited(stdout: string, _stderr: string): number {
  return stdout.split("\n").filter((l) => l.includes("UNAUDITED — no boat resolved")).length;
}

/** Scrape `N reservation line(s), M flagged.` out of the report's own summary line. */
export function parseCounts(output: string): { total: number; flagged: number } {
  const m = /(\d+)\s+reservation line\(s\),\s*(\d+)\s+flagged/.exec(output);
  return m ? { total: Number(m[1]), flagged: Number(m[2]) } : { total: 0, flagged: 0 };
}

/**
 * Run the report, capturing the two streams SEPARATELY — the table is stdout, the diagnostics and
 * triage sections are stderr. Kept apart on purpose: merging them as they arrive means the order
 * depends on how the OS interleaves two pipes, so the same report could compose differently on
 * two mornings. Composed deterministically in `main`.
 */
function runReport(): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("node_modules/.bin/tsx", ["db/xola-report.ts", "--flagged"], {
      cwd: process.cwd(),
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      stderr += `\n\n[wrapper] KILLED after ${TIMEOUT_MS / 1000}s — the report hung.\n`;
    }, TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: `${stderr}\n\n[wrapper] could not start the report: ${String(err)}\n` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

async function send(to: string[], subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set — cannot send. (Set it in .env.local on this box.)");
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.XOLA_REPORT_FROM ?? "Muster <onboarding@resend.dev>",
      to,
      subject,
      text,
    }),
  });
  if (!res.ok) throw new Error(`Resend rejected the send: ${res.status} ${await res.text()}`);
}

// ── run ──────────────────────────────────────────────────────────────────────
// Guarded so importing this file (the test does) doesn't spawn a live Xola pull — the
// `db/reset-dev.ts` idiom, and the reason the first run of the test exited 1 instead of failing.
async function main(): Promise<never> {
  const dryRun = process.argv.includes("--dry-run");

  const to = parseRecipients(process.env.XOLA_REPORT_TO);
  if (to.length === 0) {
    // Refuse loudly. Sending to nobody and exiting 0 is the failure this file is built to avoid,
    // and cron would record it as a successful morning.
    console.error("XOLA_REPORT_TO is empty or unset — refusing to run. Set it in .env.local.");
    process.exit(1);
  }

  const { ok, stdout, stderr } = await runReport();
  const { total } = parseCounts(stderr);
  const { over, chase } = urgentCounts(stderr);
  const subject = subjectFor({ ok, total, over, chase });
  const { hoisted, rest } = hoistSections(stderr);

  // A LIVE trip whose boat never resolved got no capacity check and still printed looking clean —
  // worth as much attention as an over-capacity row, so it goes up top rather than buried in the
  // pull diagnostics. Cancelled trips are excluded: their events are gone because they were
  // cancelled, and warning about them every morning is how a ⚠ becomes wallpaper.
  const unaudited = countUnaudited(stdout, stderr);

  const header = [
    subject,
    `Run at ${new Date().toISOString()} (report exit: ${ok ? "ok" : "FAILED"})`,
    ...(unaudited > 0
      ? ["", `⚠ ${unaudited} LIVE trip(s) UNAUDITED for capacity — no boat resolved, so no check ran.`]
      : []),
    "",
    "─".repeat(60),
    "",
  ].join("\n");

  const body = [
    header,
    hoisted,
    hoisted ? "─".repeat(60) + "\n" : "",
    rest,
    stdout,
  ].join("\n");

  if (dryRun) {
    console.log(`to:      ${to.join(", ")}`);
    console.log(`subject: ${subject}`);
    console.log("─".repeat(60));
    console.log(body);
    process.exit(ok ? 0 : 1);
  }

  await send(to, subject, body);
  console.error(`Sent "${subject}" to ${to.length} recipient(s).`);
  // A failed report that mailed successfully is still a failed report — cron should see non-zero.
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
