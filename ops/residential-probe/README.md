# Residential uptime probe

An external, always-on monitor that loads `crew.brewcle.com` in a real headless
browser from a **residential** network and pushes a phone alert (via
[ntfy](https://ntfy.sh)) the moment the site becomes unreachable.

## Why this exists

Production has a history of intermittent TLS / connection failures
(`ERR_SSL_PROTOCOL_ERROR`, `ERR_CONNECTION_CLOSED`) that only appear from real
client networks. The trap: **every test from a datacenter passes** while a phone
on home WiFi fails — so `curl` loops, uptime services, and CI (all datacenter-
based) are blind to it. And once the app is public, **customers won't report
errors — they just leave.** The site therefore has to report its own
reachability from the outside, from a network that looks like a customer's.

This probe is that outside observer:

- Drives a real headless **Chrome** (same QUIC/TLS path a customer's browser
  takes), not `curl` — because `curl` from the same home line has passed while
  browsers failed.
- On failure, re-checks with **QUIC disabled** (`--disable-quic`). If it then
  succeeds, the fault is QUIC-specific — a concrete lead instead of a guess.
- Alerts your phone through ntfy, an **independent** channel that still works
  when the app (or its host) is down.

### What it is NOT

On a healthy home line it will **not reproduce** the ISP-specific bug — that line
never fails. On such a network it is two things instead:

1. A **liveness alarm** — buzzes you if prod goes fully unreachable.
2. A **backstop for the cert-renewal trap** (see below) — a lapsed origin cert
   takes the site down, which this catches.

To actually reproduce the intermittent fault, run this same script on a machine
whose network has exhibited it (e.g. a crew member's home WiFi).

## Setup

On the always-on residential box (Linux, as your normal user — not root):

```sh
mkdir ~/muster-probe && cd ~/muster-probe
npm init -y
npm i playwright
npx playwright install chromium
sudo npx playwright install-deps chromium   # Linux: system libs Chrome needs

# copy probe.mjs from this repo into ~/muster-probe/
```

### Phone alerts (ntfy)

1. Install the **ntfy** app (App Store / Play Store).
2. Subscribe it to a **secret** topic name (treat it like a password — anyone who
   knows it can send you notifications). e.g. `brewcle-crew-alarm-<random>`.
3. Test: `curl -d "test" https://ntfy.sh/<your-topic>` — your phone should buzz.

The topic is passed to the probe via the `PROBE_NTFY_TOPIC` env var. **It is
never committed to this repo** — it lives only on the box (in the systemd unit).

### Run it 24/7

Use the `muster-probe.service` template in this directory. Edit the paths and set
`PROBE_NTFY_TOPIC`, then:

```sh
mkdir -p ~/.config/systemd/user
cp muster-probe.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now muster-probe
sudo loginctl enable-linger "$USER"   # survives logout / reboot
systemctl --user status muster-probe --no-pager
```

Healthy output logs `ok (HTTP 200)` (or `307`) once per interval to the console,
the systemd journal, and `probe.log`. Silence on your phone = all well.

### Prove the alarm fires

Point it at a dead address, sped up:

```sh
PROBE_URL=https://this-host-does-not-exist.invalid/ PROBE_INTERVAL_MS=3000 \
  PROBE_FAILS=2 PROBE_NTFY_TOPIC=<your-topic> node probe.mjs
```

Within ~10s your phone should buzz with **"crew.brewcle.com UNREACHABLE."**
`Ctrl-C` to stop.

## Config (env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `PROBE_NTFY_TOPIC` | *(required)* | Secret ntfy topic your phone is subscribed to. Probe refuses to start without it. |
| `PROBE_URL` | `https://crew.brewcle.com/` | URL to check. |
| `PROBE_INTERVAL_MS` | `60000` | Milliseconds between checks. |
| `PROBE_FAILS` | `2` | Consecutive failures before the alarm fires (kills single-blip flapping). |

## Context: the Cloudflare flip and the cert-renewal trap

The mitigation paired with this probe: `crew.brewcle.com` was switched in
Cloudflare from **DNS-only (grey cloud)** to **Proxied (orange cloud)** with
SSL/TLS mode **Full (Strict)**. Cloudflare now terminates TLS at its own edge and
fetches the Vercel origin datacenter-to-datacenter — so client browsers no longer
handshake with Vercel's edge POPs, which is where the intermittent failures live.
Rollback is one click: set the `crew` record back to DNS-only.

**The trap this introduces:** Vercel auto-renews its origin Let's Encrypt cert
(~30 days before expiry). With Cloudflare proxying, Vercel's renewal challenge may
not reach the origin, so the cert can **silently fail to renew** and then Full
(Strict) breaks and the site goes down. This probe is the backstop — it will
catch that outage — but check the runway proactively:

```sh
# reads the actual Vercel origin cert, bypassing Cloudflare
echo | openssl s_client -connect efabc4ee1912cd0a.vercel-dns-016.com:443 \
  -servername crew.brewcle.com 2>/dev/null | openssl x509 -noout -issuer -enddate
```

As of 2026-07-15 the origin cert `notAfter` is **Sep 23 2026**, so the first
at-risk auto-renewal is roughly **Aug 24 2026**. Set a reminder a couple weeks
ahead of that.

## The permanent fix

The renewal trap exists only because Cloudflare fronts a host (Vercel) that
insists on managing its own origin cert. The durable end state is to move the
origin to a **VPS** where we own the whole TLS path — Caddy (or a long-lived
Cloudflare Origin certificate) terminates at the origin with no renewal-through-
proxy conflict, Cloudflare stays in front, and the Vercel edge bug is gone for
good. Muster has near-zero Vercel lock-in (no `@vercel/*` deps, no edge runtime,
no `next/image`; the only Vercel-specific piece is the three cron URLs, which
become system-crontab entries hitting the `CRON_SECRET` routes). When that
migration lands, this probe keeps working unchanged — repoint `PROBE_URL` if the
hostname changes.
