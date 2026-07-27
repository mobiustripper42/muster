---
id: DEC-TBD
title: "Open questions (carried from the spec; not Claude's to set alone)"
topic: "Open questions"
---

## DEC-TBD: Open questions (carried from the spec; not Claude's to set alone)

These are deferred by design. Each names an owner and a trigger. **Consult @architect (and the named
human owner) before building past the trigger.**

- ~~**Stack / framework / DB / host @ M4** — the DEC-013 decision itself. *Trigger: task 1.5a.*~~ — **RESOLVED by DEC-020** (Next.js/Vercel; Postgres-behind-the-port, host deferred; self-rolled magic-link; no platform adopted).
- ~~**SMS + push provider, and native vs PWA**~~ — **RESOLVED** by DEC-MSG-1 (SMS = eventual
  production adapter, not in the slice) + DEC-MSG-2 (native Capacitor, de-prioritized) + DEC-MSG-3
  (one port; fake + pilot adapters at M4). Remaining: operator picks the pilot adapter (web-link or
  Telegram) at M4; Twilio + 10DLC confirmed at the later adapter swap.
- **Deposit-vs-full payment & refund-schedule numbers** — **ACTIVATED by DEC-107** (payments are now in
  the 2026 build for Muster-native sales). Operator chose **deposit + balance**; the deposit-%, balance
  timing, refund policy, and **which Stripe account** remain *Owner: Drew* and gate only the Stripe task.
- **Credit-vs-cash default ordering** in the cancel flow — lean credit-first, cash always available.
  *Owner: Drew.* (Muster-side refund cascade stays parked — DEC-107; Xola-booking refunds stay in Xola —
  DEC-105.)
- **Which "M" (soft) rules ship** for BrewBoat v1 (TWIC, medical, drug consortium, duty-hour,
  weather/tide) — *Owner: Spink/Drew against real operations. SPEC §1.3.*
- **Concrete horizon values** — how many days is the staffing horizon? *Ship a dumb default, tune.
  SPEC §4.* **(Where the value lives is fixed by DEC-022 — a single `leadDays` constant — and now
  **env-tunable** per DEC-062 (`STAFFING_HORIZON_LEAD_DAYS`, default 7d). Only the operator's chosen
  number remains open; the plumbing is done.)*
- **Reliability weights** — bail-lateness curve, ack weight, decay. *Flat v1; tune in Pass A. SPEC §1.4.*
- **Event-Admin merge rule** — manual entries vs CSV re-import reconciliation. *Default "manual wins,
  flag conflicts"; refine against a real export. SPEC §2.2.*
- **"Exhausted" threshold** (when a shift lands on the At-Risk board) and the **split-suggestion gap
  threshold** — *keep the bar high; tune later. SPEC §2.5, §2.3.* **(Where the value lives is now
  fixed by task 3.3 — `EXHAUSTED_THRESHOLD_HOURS` in `at-risk-board.ts`, gating route-(b) imminence
  (any uncrewed required seat within the window, **DEC-065** — no longer the willingness-exhaustion
  gate); eligibility-exhaustion boards immediately. Default ships at 48h; only the number remains
  tune-later. Split-suggestion gap still open.)*
- ~~**Historical Xola data** — migrate vs read-only archive. *Leaning archive. SPEC §4.*~~ — **SETTLED by
  DEC-105: never migrate.** Coexistence is permanent; Xola drains naturally and is cancelled when empty.
  No historical import, no forced cutover.
- ~~**Doorbell batch / cancel-window interval** (Phase 6)~~ — **RESOLVED by DEC-060** (task 6.3):
  batch/cancel **90 s** (`DOORBELL_BATCH_WINDOW_MS`), presence-staleness **5 min**
  (`DOORBELL_PRESENCE_WINDOW_MS`); env-overridable, ratified by Eric, tune-on-real-use stays.
- **Short-notice-as-text content posture** (Phase 6, artifact §7.5) — the SMS body carrying message
  *content* (vs a bare "tap to open" ping) is a different TCPA / content posture than the
  strictly-transactional ask (DEC-MSG-1). *Owner: Drew + the 10DLC registration — confirm which
  message types / lengths qualify before the SMS doorbell adapter ships.*
