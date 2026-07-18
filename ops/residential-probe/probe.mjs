// Residential uptime probe for crew.brewcle.com.
//
// Why this exists: production TLS/connection failures (see the "Intermittent
// TLS" incident notes) are only visible from real residential/browser paths —
// curl from a datacenter passes while a phone on home WiFi fails. This probe
// runs on an always-on machine on a residential line, loads the site in a real
// headless Chrome (same QUIC/TLS path a customer takes), and pushes a phone
// alert via ntfy the moment the site becomes unreachable. Customers on a public
// reservation flow will never report an error — they just bounce — so the site
// has to report its own reachability from the outside.
//
// It is NOT a bug reproducer on a healthy network: if the host line never
// exhibits the fault, this is a liveness alarm + a backstop for the Cloudflare
// origin-cert-renewal trap (a lapsed Vercel origin cert takes the site down,
// which this catches). To actually reproduce the ISP-specific fault, run the
// same script on a machine whose network has failed.
//
// Config via env (see README.md):
//   PROBE_NTFY_TOPIC   required — the secret ntfy topic your phone subscribes to
//   PROBE_URL          default https://crew.brewcle.com/
//   PROBE_INTERVAL_MS  default 60000
//   PROBE_FAILS        default 2      consecutive fails before the alarm fires

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const NTFY = process.env.PROBE_NTFY_TOPIC;
if (!NTFY) {
  console.error(
    "PROBE_NTFY_TOPIC is not set — refusing to start without an alert channel.\n" +
      "Set it to your secret ntfy topic (the one your phone is subscribed to)."
  );
  process.exit(1);
}

const URL_ = process.env.PROBE_URL || "https://crew.brewcle.com/";
const INTERVAL_MS = Number(process.env.PROBE_INTERVAL_MS || 60000);
const FAIL_THRESHOLD = Number(process.env.PROBE_FAILS || 2);
const LOGFILE = new URL("probe.log", import.meta.url);

let fails = 0;
let alerting = false;

function log(msg) {
  const line = `${new Date().toISOString()}  ${msg}`;
  console.log(line);
  try {
    appendFileSync(LOGFILE, line + "\n");
  } catch {
    /* logging is best-effort; never let it crash the probe */
  }
}

// Single-quote for the shell, escaping embedded single quotes.
function sh(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function notify(title, body) {
  try {
    execSync(`curl -s -H ${sh("Title: " + title)} -d ${sh(body)} https://ntfy.sh/${NTFY}`);
  } catch (e) {
    log("notify failed: " + e.message);
  }
}

// One reachability check via a real headless Chrome. We only care that the TLS
// handshake completed and the server answered — any HTTP status counts as "up";
// the failure we hunt is the connection/handshake dying before a response.
async function check(args = []) {
  const browser = await chromium.launch({ args });
  try {
    const page = await browser.newPage();
    const resp = await page.goto(URL_, { waitUntil: "commit", timeout: 15000 });
    return resp ? { ok: true, status: resp.status() } : { ok: false, err: "no response" };
  } catch (e) {
    return { ok: false, err: (e.message || String(e)).split("\n")[0] };
  } finally {
    await browser.close();
  }
}

// On failure, grab what a plain curl sees (status + the IP it actually hit —
// tells Cloudflare vs Vercel origin apart) to attach to the alert.
function curlProbe() {
  try {
    return (
      "curl: " +
      execSync(
        `curl -sS -o /dev/null -w '%{http_code} via %{remote_ip}' --max-time 10 ${sh(URL_)}`,
        { timeout: 12000 }
      )
        .toString()
        .trim()
    );
  } catch (e) {
    return "curl: FAIL — " + (e.stderr?.toString() || e.message).split("\n")[0];
  }
}

log(
  `monitor started -> ${URL_}  (every ${INTERVAL_MS / 1000}s, alarm after ${FAIL_THRESHOLD} fails)`
);

for (;;) {
  const r = await check();
  if (r.ok) {
    log(`ok (HTTP ${r.status})`);
    if (alerting) {
      notify("crew.brewcle.com back up", `HTTP ${r.status}`);
      alerting = false;
    }
    fails = 0;
  } else {
    fails++;
    log(`FAIL #${fails}: ${r.err}`);
    if (fails >= FAIL_THRESHOLD && !alerting) {
      // A/B the QUIC path: if it loads with QUIC disabled but not with it on,
      // the failure is QUIC-specific — a concrete lead, not a guess.
      const noQuic = await check(["--disable-quic"]);
      const body =
        `browser: FAIL — ${r.err}\n` +
        `browser (no QUIC): ${noQuic.ok ? `OK ${noQuic.status} -> QUIC path suspect` : `FAIL — ${noQuic.err}`}\n` +
        curlProbe();
      notify("crew.brewcle.com UNREACHABLE", body);
      log("ALARM SENT\n" + body);
      alerting = true;
    }
  }
  await new Promise((res) => setTimeout(res, INTERVAL_MS));
}
