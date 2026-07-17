#!/usr/bin/env bash
# brewcle.com layered downtime monitor.  See README.md.
#
# Climbs a diagnostic ladder every cycle and CLASSIFIES the failure by layer:
#   DNS -> TCP -> TLS -> Cloudflare edge -> origin (HostGator) -> WordPress app.
# Cloudflare's own 52x codes separate "Cloudflare is fine, origin isn't" from a
# real edge problem; a body scan catches WordPress-up-but-broken (DB error /
# critical error / white screen) that a plain 200-check would miss; and an
# optional origin-bypass (curl --resolve straight to the HostGator IP) makes the
# Cloudflare-vs-origin cut definitive.
#
# Modes:  loop (default) | once | calibrate | summary [days]
#
# Config via env:
#   PROBE_NTFY_TOPIC  required for alerts (secret; never committed)
#   PROBE_HOST        default brewcle.com
#   PROBE_ORIGIN_IP   default 192.185.4.121   (HostGator origin, for the bypass cut)
#   PROBE_INTERVAL    default 60   seconds between checks
#   PROBE_FAILS       default 2    consecutive fails before the alarm fires
#   PROBE_SLOW_MS     default 8000 response time over this = SLOW (WordPress/PHP strain)
#   PROBE_DIR         default ~/brewcle-monitor   (script data + logs live here)
set -u

HOST="${PROBE_HOST:-brewcle.com}"
ORIGIN_IP="${PROBE_ORIGIN_IP:-192.185.4.121}"
NTFY_TOPIC="${PROBE_NTFY_TOPIC:-}"
INTERVAL="${PROBE_INTERVAL:-60}"
FAIL_THRESHOLD="${PROBE_FAILS:-2}"
SLOW_MS="${PROBE_SLOW_MS:-8000}"
DIR="${PROBE_DIR:-$HOME/brewcle-monitor}"
RESOLVERS=("1.1.1.1" "8.8.8.8")

mkdir -p "$DIR"
EVENTS="$DIR/events.tsv"          # incident ledger (tab-separated; summary reads this)
LOG="$DIR/probe.log"
ORIGIN_OK_FLAG="$DIR/.origin_bypass_ok"

# classify() result globals
LABEL=""; DETAIL=""; HTTP=""; POP=""; CACHE=""; RESP_MS=""; ORIGIN_RESULT=""

ts()  { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { printf '%s  %s\n' "$(ts)" "$*" | tee -a "$LOG"; }

notify() {
  local title="$1" body="$2"
  if [ -z "$NTFY_TOPIC" ]; then log "NO NTFY_TOPIC — would alert: $title"; return; fi
  curl -s -H "Title: $title" -d "$body" "https://ntfy.sh/$NTFY_TOPIC" >/dev/null 2>&1 \
    || log "ntfy send failed"
}

# origin_cut: only meaningful once 'calibrate' proved the origin answers direct hits.
# Hits the HostGator IP directly, bypassing Cloudflare, to split CF from origin.
origin_cut() {
  ORIGIN_RESULT=""
  if [ ! -f "$ORIGIN_OK_FLAG" ]; then ORIGIN_RESULT="(origin-bypass not calibrated)"; return; fi
  local ocode oxit
  ocode="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 \
           --resolve "$HOST:443:$ORIGIN_IP" "https://$HOST/?ocut=$RANDOM" 2>/dev/null)"; oxit=$?
  if [ "$oxit" -eq 0 ] && [[ "$ocode" =~ ^[23] ]]; then
    # Origin is healthy when hit directly, but the Cloudflare path failed => it's CF.
    ORIGIN_RESULT="origin-direct OK ($ocode) => CLOUDFLARE/edge is the fault"
    LABEL="CLOUDFLARE"
    DETAIL="$DETAIL | origin healthy on direct hit, so Cloudflare (POP=$POP) is the problem"
  else
    ORIGIN_RESULT="origin-direct also FAILED (code=$ocode exit=$oxit) => origin/WordPress confirmed"
    DETAIL="$DETAIL | origin-direct also down"
  fi
}

# classify: run the ladder, set LABEL/DETAIL/HTTP/POP/CACHE/RESP_MS (+ORIGIN_RESULT if not OK)
classify() {
  LABEL=""; DETAIL=""; HTTP=""; POP=""; CACHE=""; RESP_MS=""; ORIGIN_RESULT=""
  local cb="cb=$RANDOM$RANDOM"

  # 1) DNS — try both resolvers before calling it dead
  local dns
  dns="$(dig +short "$HOST" @"${RESOLVERS[0]}" 2>/dev/null)"
  [ -z "$dns" ] && dns="$(dig +short "$HOST" @"${RESOLVERS[1]}" 2>/dev/null)"
  if [ -z "$dns" ]; then LABEL="DNS_FAIL"; DETAIL="no A record from ${RESOLVERS[*]}"; return; fi

  # 2) fetch via Cloudflare, cache-busted so we see live origin state not a cached ghost
  local body hdrs out code tt rip cxit
  body="$(mktemp)"; hdrs="$(mktemp)"
  out="$(curl -sS -o "$body" -D "$hdrs" -w '%{http_code} %{time_total} %{remote_ip}' \
        --max-time 15 "https://$HOST/?$cb" 2>/dev/null)"; cxit=$?
  code="$(awk '{print $1}' <<<"$out")"; tt="$(awk '{print $2}' <<<"$out")"; rip="$(awk '{print $3}' <<<"$out")"
  RESP_MS="$(awk -v t="${tt:-0}" 'BEGIN{printf "%d", t*1000}')"
  HTTP="$code"
  POP="$(grep -i '^cf-ray:' "$hdrs" 2>/dev/null | sed -E 's/.*-([A-Za-z]+)\r?$/\1/' | head -1)"
  CACHE="$(grep -i '^cf-cache-status:' "$hdrs" 2>/dev/null | awk '{print $2}' | tr -d '\r' | head -1)"

  # 2a) transport-level failure (curl couldn't complete the request)
  if [ "$cxit" -ne 0 ]; then
    case "$cxit" in
      6)                 LABEL="DNS_FAIL"; DETAIL="curl could not resolve $HOST";;
      7)                 LABEL="TCP_FAIL"; DETAIL="connection refused/unreachable (Cloudflare edge)";;
      28)                LABEL="TIMEOUT";  DETAIL="no response within 15s";;
      35|51|58|59|60|77|83) LABEL="TLS_FAIL"; DETAIL="TLS/cert error (curl exit $cxit)";;
      *)                 LABEL="CONN_FAIL"; DETAIL="curl exit $cxit";;
    esac
    rm -f "$body" "$hdrs"; origin_cut; return
  fi

  # 2b) got an HTTP response — read the layer it points at
  case "$code" in
    521|522|523|524|525|526)
      LABEL="CF_ORIGIN_DOWN"; DETAIL="Cloudflare $code — origin (HostGator) unreachable/erroring";;
    508)
      LABEL="HOST_RESOURCE_LIMIT"; DETAIL="508 — HostGator shared-hosting CPU/RAM cap hit";;
    5??)
      LABEL="HTTP_5XX"; DETAIL="origin returned $code";;
    2??|3??)
      if grep -qi "error establishing a database connection" "$body"; then
        LABEL="WP_DB_DOWN"; DETAIL="WordPress: database connection error (served as HTTP $code)"
      elif grep -qi "there has been a critical error\|critical error on this website" "$body"; then
        LABEL="WP_CRITICAL"; DETAIL="WordPress: critical-error page (HTTP $code)"
      elif [ "$(wc -c <"$body")" -lt 512 ]; then
        LABEL="WP_BLANK"; DETAIL="near-empty $code body ($(wc -c <"$body")B) — possible white screen"
      elif [ "${RESP_MS:-0}" -gt "$SLOW_MS" ]; then
        LABEL="SLOW"; DETAIL="up but slow: ${RESP_MS}ms (>${SLOW_MS}ms) — origin/PHP strain"
      else
        LABEL="OK"; DETAIL="HTTP $code ${RESP_MS}ms cache=$CACHE pop=$POP"
      fi;;
    *)
      LABEL="HTTP_$code"; DETAIL="unexpected status $code";;
  esac
  rm -f "$body" "$hdrs"
  [ "$LABEL" != "OK" ] && origin_cut
}

loop() {
  log "monitor start -> https://$HOST  (every ${INTERVAL}s, alarm after ${FAIL_THRESHOLD} fails, origin=$ORIGIN_IP)"
  local fails=0 down=0 down_start="" down_label="" down_epoch=0
  while :; do
    classify
    if [ "$LABEL" = "OK" ]; then
      log "OK  ${RESP_MS}ms cache=$CACHE pop=$POP"
      if [ "$down" -eq 1 ]; then
        local end dur; end="$(ts)"; dur=$(( $(date +%s) - down_epoch ))
        printf '%s\t%s\t%ss\tup\t%s\n' "$down_start" "$end" "$dur" "$down_label" >>"$EVENTS"
        notify "brewcle.com recovered" "back up after ${dur}s (was: $down_label)"
        down=0
      fi
      fails=0
    else
      fails=$((fails+1))
      log "FAIL#$fails  $LABEL — $DETAIL ${ORIGIN_RESULT:+| $ORIGIN_RESULT}"
      if [ "$fails" -ge "$FAIL_THRESHOLD" ] && [ "$down" -eq 0 ]; then
        down=1; down_start="$(ts)"; down_epoch="$(date +%s)"; down_label="$LABEL"
        printf '%s\t\t\tdown\t%s\n' "$down_start" "$LABEL" >>"$EVENTS"
        notify "brewcle.com DOWN — $LABEL" "$DETAIL
${ORIGIN_RESULT}
pop=$POP cache=$CACHE resp=${RESP_MS}ms http=$HTTP"
      fi
    fi
    sleep "$INTERVAL"
  done
}

calibrate() {
  echo "Calibrating origin-bypass against $ORIGIN_IP (the site should be UP right now)..."
  local ocode oxit
  ocode="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 \
           --resolve "$HOST:443:$ORIGIN_IP" "https://$HOST/?cal=$RANDOM" 2>/dev/null)"; oxit=$?
  if [ "$oxit" -eq 0 ] && [[ "$ocode" =~ ^[23] ]]; then
    touch "$ORIGIN_OK_FLAG"
    echo "ENABLED — origin answered $ocode on a direct hit. The Cloudflare-vs-origin cut is live."
  else
    rm -f "$ORIGIN_OK_FLAG"
    echo "DISABLED — origin-direct failed (code=$ocode exit=$oxit)."
    echo "HostGator most likely firewalls the origin to Cloudflare IPs. That's fine —"
    echo "the monitor still classifies via Cloudflare's 52x codes and WordPress body checks."
  fi
}

summary() {
  local days="${1:-7}" since
  since="$(date -d "-${days} days" +%s 2>/dev/null || echo 0)"
  if [ ! -s "$EVENTS" ]; then echo "No incidents logged yet ($EVENTS)."; return; fi
  echo "brewcle.com incidents — last ${days}d"
  awk -F'\t' -v since="$since" '
    $4=="up" {
      cmd="date -d \"" $1 "\" +%s 2>/dev/null"; cmd | getline e; close(cmd)
      if (e+0 >= since) { n[$5]++; secs[$5]+=($3+0); tot++; total+=($3+0) }
    }
    END {
      if (tot==0) { print "  (no completed incidents in window)"; exit }
      for (l in n) printf "  %-20s %3d incident(s)   %6ds downtime\n", l, n[l], secs[l]
      printf   "  %-20s %3d total        %6ds downtime\n", "ALL", tot, total
    }' "$EVENTS" | sort -k2 -rn
  echo "(labels: WP_* = WordPress · HOST_RESOURCE_LIMIT/HTTP_5XX/CF_ORIGIN_DOWN = origin · CLOUDFLARE/TLS/TCP/DNS = layers above WordPress)"
}

case "${1:-loop}" in
  loop)      loop;;
  once)      classify; echo "LABEL=$LABEL"; echo "DETAIL=$DETAIL"; echo "http=$HTTP pop=$POP cache=$CACHE resp=${RESP_MS}ms"; echo "origin: ${ORIGIN_RESULT:-n/a}";;
  calibrate) calibrate;;
  summary)   summary "${2:-7}";;
  *)         echo "usage: $0 {loop|once|calibrate|summary [days]}"; exit 1;;
esac
