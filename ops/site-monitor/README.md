# brewcle.com layered downtime monitor

Watches the WordPress marketing site (`brewcle.com`) and, when it goes down,
tells you **which layer failed** — DNS, TCP, TLS, Cloudflare, the HostGator
origin, or WordPress itself — instead of a bare "site down." Pushes a phone
alert (ntfy) with the culprit in the title, and keeps an incident ledger so you
can prove *where* the intermittent failures actually live.

Sibling of `../residential-probe/`, but a different tool: this one is
`curl`/`dig`/`openssl`, not a headless browser, because the job is layer
isolation, not "did it render."

## Topology (as of 2026-07)

- `brewcle.com` is **delegated to Cloudflare** (`adaline`/`brady.ns.cloudflare.com`)
  and **proxied** (apex resolves to Cloudflare `104.21.x` / `172.67.x`, `cf-ray`
  present, `cf-cache-status: DYNAMIC`). Cloudflare terminates TLS.
- Origin = **HostGator `192.185.4.121`** (the apex A record in HostGator's own
  cPanel zone — which is otherwise **vestigial**: cPanel auto-generates a full
  DNS zone per domain, but nothing resolves against it since the domain is
  delegated to Cloudflare).

## What it can and cannot see

- **Global / origin failures** (WordPress DB error, PHP critical error, HostGator
  508 resource limit, origin 5xx) hit one server and fail for **everyone** — this
  single probe catches them perfectly.
- **Regional failures** (a bad Cloudflare POP, a peering/ISP problem on one
  person's path) can be down for one location and fine for another. A probe in
  Ohio **cannot** see a Florida-only failure. If reports cluster by geography,
  run this same script on a box near the affected user — it's a drop-in second
  vantage. The Cloudflare POP is logged (`pop=…`, from `cf-ray`) so you can tell
  which edge each probe is hitting.

Corollary for triage: **a user reporting "down" while this probe shows green at
that timestamp = an upper-layer/regional problem, NOT WordPress.** User down +
probe red together = origin/WordPress.

## The ladder → labels

| Layer | Label(s) |
|---|---|
| DNS | `DNS_FAIL` |
| TCP to Cloudflare edge | `TCP_FAIL`, `TIMEOUT` |
| TLS | `TLS_FAIL` |
| Cloudflare says origin is bad | `CF_ORIGIN_DOWN` (HTTP 521–526) |
| HostGator resource cap | `HOST_RESOURCE_LIMIT` (HTTP 508) |
| Origin 5xx | `HTTP_5XX` |
| WordPress up-but-broken | `WP_DB_DOWN`, `WP_CRITICAL`, `WP_BLANK` |
| Up but slow | `SLOW` |
| Cloudflare's own fault (via origin-bypass) | `CLOUDFLARE` |
| Healthy | `OK` |

Two things a naive check gets wrong, handled here: Cloudflare can serve a cached
200 while WordPress is dead (so every request is **cache-busted** and
`cf-cache-status` is recorded), and WordPress serves its DB/critical-error pages
with a **200** status (so the **body** is scanned, not just the code).

## The origin-bypass cut

On any failure, if calibrated, the monitor also hits the HostGator IP directly
(`curl -k --resolve brewcle.com:443:192.185.4.121`), bypassing Cloudflare:
origin-direct **OK** but Cloudflare path **failed** ⇒ label `CLOUDFLARE`; both
failed ⇒ origin/WordPress confirmed. `-k` is deliberate — we're testing origin
*reachability*, not its cert (the public trusts Cloudflare's cert, not the
origin's).

HostGator may firewall the origin to Cloudflare IPs, which would make a direct
hit false-negative. So run `calibrate` once **while the site is up**: if the
origin answers, the bypass is enabled; if not, it's disabled and the monitor
leans on the 52x codes + body checks instead. No guessing.

## Setup

```sh
mkdir -p ~/brewcle-monitor
# put brewcle-probe.sh in ~/brewcle-monitor/ and: chmod +x ~/brewcle-monitor/brewcle-probe.sh

# 1. calibrate the origin-bypass (site must be up)
~/brewcle-monitor/brewcle-probe.sh calibrate

# 2. one manual classification
PROBE_NTFY_TOPIC=<your-secret-topic> ~/brewcle-monitor/brewcle-probe.sh once

# 3. run 24/7 — edit PROBE_NTFY_TOPIC in the unit, then:
cp brewcle-monitor.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now brewcle-monitor
sudo loginctl enable-linger "$USER"
```

## Reading the results

- Live log: `tail -f ~/brewcle-monitor/probe.log`
- Incident ledger: `~/brewcle-monitor/events.tsv` (one row per down + recovery)
- **The payoff:** `~/brewcle-monitor/brewcle-probe.sh summary 7` tallies incidents
  by label over the last 7 days. After a week this settles the "is it WordPress?"
  question with counts — e.g. `9× WP_DB_DOWN, 2× SLOW, 0× DNS/TLS/CLOUDFLARE`.

## Watching more than one host

The script is host-agnostic — alerts, logs, and the incident ledger all key off
`PROBE_HOST`. To watch a second host (e.g. `www.brewcle.com`, which is what Google
Ads points at), run a second instance with its own `PROBE_DIR` so the logs don't
collide, and its own systemd unit:

```sh
PROBE_HOST=www.brewcle.com PROBE_DIR=~/www-brewcle-monitor ./brewcle-probe.sh calibrate
# then a brewcle-www-monitor.service with Environment=PROBE_HOST=www.brewcle.com,
# PROBE_DIR=%h/www-brewcle-monitor, and the same (or a distinct) PROBE_NTFY_TOPIC.
```

Both instances can share one ntfy topic — alert titles carry the host
(`www.brewcle.com DOWN — …`), so they're unambiguous.

## Config (env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `PROBE_NTFY_TOPIC` | *(none)* | Secret ntfy topic for phone alerts. No alerts if unset. |
| `PROBE_HOST` | `brewcle.com` | Host to watch. |
| `PROBE_ORIGIN_IP` | `192.185.4.121` | HostGator origin, for the bypass cut. |
| `PROBE_INTERVAL` | `60` | Seconds between checks. |
| `PROBE_FAILS` | `2` | Consecutive fails before alarm (anti-flap). |
| `PROBE_SLOW_MS` | `8000` | Response time over this = `SLOW`. |
| `PROBE_DIR` | `~/brewcle-monitor` | Where the script's logs/ledger live. |
