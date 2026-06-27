/**
 * Human-drivable Smart Doorbell harness CLI (#115, Phase 6.5). The dev surface for
 * the pure decider (#114) — NO database, NO real sends (the decider isn't wired to
 * delivery until 6.6; this records "would-ring" decisions only). Drive it two ways:
 *
 *   npm run db:doorbell              # interactive REPL — type commands, watch the board
 *   npm run db:doorbell -- saturday  # replay the narrated Saturday-morning scenario
 *
 * All logic lives in src/messaging/doorbell-harness.ts (unit-tested); this is just
 * the I/O glue, the doorbell analog of db/tick-dev.ts. `help` lists the commands.
 */
import { createInterface } from "node:readline";
import { DoorbellHarness } from "../src/messaging/doorbell-harness.js";

const SCENARIOS: Record<string, string> = {
  // Mirrors the harness spec (doorbell-harness.test.ts) — the artifact §9 walkthrough.
  saturday: `
# Saturday morning. Four crew on the cohort thread.
thread sat alice bob carol dave
# alice is reading the thread; bob is in the app but elsewhere; carol + dave are away.
present alice sat here
present bob sat elsewhere
# The operator posts the morning note.
post sat operator Dock at slip B, call 12:30
# Fire the doorbell: nobody absent rings yet — the 90s batch window is still open.
tick
# 30s later a second note lands and batches in.
advance 30s
post sat operator Bring extra PFDs
# 60s more: the oldest note crosses 90s → the two absent crew get ONE batched ring each.
advance 60s
tick
# carol opens the thread (cancel-on-read); dave's thread stays quiet (first-only-until-read).
read carol sat
advance 10s
decide
# A priority jumps the queue — it rings through even the quiet/held threads.
post sat operator Slip changed to C -p
tick
# The would-ring log: only the absent ever got an SMS. The present made all the noise, silently.
rings
`,
};

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
}

function runScenario(h: DoorbellHarness, script: string): void {
  for (const line of script.split("\n")) {
    const t = line.trim();
    if (t === "") {
      console.log("");
    } else if (t.startsWith("#")) {
      console.log(`\x1b[2m${t}\x1b[0m`); // dim narration
    } else {
      console.log(`\x1b[36m› ${t}\x1b[0m`); // cyan command echo
      const out = h.exec(t);
      if (out) console.log(indent(out));
    }
  }
}

function repl(h: DoorbellHarness): void {
  console.log("Smart Doorbell harness (#115). Type 'help'; 'quit' to exit.\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "doorbell> " });
  rl.prompt();
  rl.on("line", (line) => {
    const t = line.trim();
    if (t === "quit" || t === "exit") {
      rl.close();
      return;
    }
    const out = h.exec(t);
    if (out) console.log(out);
    rl.prompt();
  });
  rl.on("close", () => {
    console.log("bye");
    process.exit(0);
  });
}

const arg = process.argv[2];
const harness = new DoorbellHarness();

if (arg === undefined || arg === "repl") {
  repl(harness);
} else {
  const script = SCENARIOS[arg];
  if (script === undefined) {
    console.error(
      `unknown scenario: ${arg}\navailable: ${Object.keys(SCENARIOS).join(", ")} — or omit the arg for the interactive REPL.`,
    );
    process.exit(1);
  }
  runScenario(harness, script);
}
