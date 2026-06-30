# Tiller — Latency-aware drip leash: spend patience where it's earned

> 🌙 **Tiller** — overnight idea, one per visit. Draft, never auto-merge. Eric is the gate.

## The pitch

### The idea

Muster's Tier-1 ask fan-out is a staged **drip** (DEC-063). Per open seat the tick seeds one ask to
the top reliability-ranked candidate, then **widens by one more candidate every
`ASK_DRIP_INTERVAL_MINUTES`** (default 15) until someone accepts or the pool is walked — so the
reliability ranking drives *timing*, not just outbox display order. `widenDue(seat, asks, dripMs, now)`
is the gate: an `Asked` seat waits `dripMs` from its most recent ask before the next person gets poked.

That leash is **one global number for everyone.** But the engine already knows how long each crew
member *actually takes to answer*: every response logs `metadata.latencyMs` (ms from `ask_sent` to
reply) on `ask_accepted` / `ask_declined` events. It's logged richly — "log rich, score dumb"
(DEC-008) — and consumed by **nothing**. The score weights `ask_accepted` a flat `1` and throws the
latency away.

Make the drip leash **per-candidate**, learned from the held candidate's own logged latency. Before
widening *past* the most-recently-asked person, wait a leash derived from *their* response history
(a p75 of recent `latencyMs`), clamped to a tenant-owned `[floor, ceiling]` and never past the
fills-by deadline:

- The reliable-but-slow captain who always answers in ~40 minutes gets her ~40 minutes — instead of
  being widened past at minute 15, every single time, before she's even seen the ask.
- The historically-snappy crew member who isn't biting *this* time gets widened past at the floor
  (~a few minutes) instead of holding the seat hostage for a flat 15.
- Cold-start crew (too few samples) fall back to the flat default — exactly today's behavior.

The drip already exists to protect the top-ranked person's *first crack* before blasting the pool.
This makes that protection **fit the person** instead of fitting a fleet-wide guess.

### Why it's worth it

The drip is the one place reliability rank touches the wall clock, and the leash is the whole knob.
A flat leash is a crude proxy for the thing it's actually trying to buy — *"give the right person
enough time to answer before moving on."* Set it short (today's 15, tick-aligned) and you widen past
your most reliable slow responders before they wake up and look at their phone, diluting the pool and
pre-spending goodwill on people the engine itself ranked lower. Set it long and a fast pool crawls.
There is no global number that's right, because "enough time" is a property of the *person*, and the
engine has measured that property on every ask it ever sent. The leash is where that measurement pays
off — and it costs no schema, no new event, no new surface. It's a pure function over a log column
that's been filling up since the first commit, waiting for a consumer.

### Why he hasn't already

Two reasons, and the second is the interesting one.

First, the drip is **brand new** and shipped as a deliberately dumb single knob — "dumb default, tune
per pilot," tick-aligned at 15, with `0` as the blast-all rollback. That's the right way to ship a new
mechanism. The flat leash was never wrong; it was *first*.

Second — and this is the unlock — `latencyMs` has always been **miscatalogued**. It was logged under
"someday it feeds the score," and the parked FUTURE_IDEAS items point the same way: *volume-neutral
reliability scoring* (latency → the score), *per-crew learned ask time* (history → what hour to send).
Everyone's instinct, including the code's own comments, files responsiveness under **reliability**.
But responsiveness *isn't* reliability: a slow-but-always-yes captain is more reliable than a
fast-but-flaky one, and folding latency into the score would actively misrank them. So "use latencyMs"
stayed parked — correctly — because its obvious home (the score) is the *wrong* home, and nobody
reached for the right one.

The flip: **latency belongs in patience, not priority.** The score answers *who do we ask first*;
the leash answers *how long do we wait before asking the next person*. Latency is the wrong input to
the first and the exactly-right input to the second. Once you separate the two questions, the parked
item splits cleanly — yes-rate drives priority, time-to-yes drives patience — and the leash is the
first honest brick of that wall. It's a new *consumer* of an existing signal, not a new signal and
not a spec change.

---

## The build handoff

### Approach

- **A pure deriver, no new state, no schema change.** A new framework-free function reads each
  candidate's existing `ReliabilityEvent` log, takes a p75 over recent `latencyMs` values, and returns
  a leash in ms. `now` injected, repo behind the port, Vitest-tested — same shape as
  `reliability-score.ts`, which is the file to mirror for the read pattern (`windowedEvents`,
  `reliabilityEventsFor`).
- **Wire it into the one gate.** `tick.ts`'s widen loop currently computes a single `dripMs` and hands
  it to `widenDue` for every seat. Instead, resolve the leash for the **most-recently-asked candidate
  on that seat** (the frontier we're being patient with) and pass *that* to `widenDue`. Everything
  else in the loop is untouched — the blast path (`urgent`), `widenAsk`, `rankedEligible`, the
  Tier-2 hand-off all stay exactly as they are.
- **Latency = patience only.** Do **not** touch `reliability-score.ts` or the ranking. The score stays
  the flat sum it is. This separation is the whole idea and also the anti-gaming property (see Gotchas).
- **Three guardrails are load-bearing, not polish** (from the panel — drop them and it becomes an
  unpredictable, anxiety-leaking babysitter):
  1. **Min-sample floor.** Below `MIN_LATENCY_SAMPLES` answered asks with a `latencyMs`, return the
     flat default — never personalize on one fluky 6-hour sample.
  2. **`[floor, ceiling]` bounds = tenant policy; horizon clamp = mechanism.** Clamp the personal
     leash to `[DRIP_LEASH_FLOOR, DRIP_LEASH_CEILING]`, then additionally to
     `remainingHorizon / candidatesRemaining` so the *sum* of waits across a seat's remaining pool can
     never overrun the fills-by deadline. (Urgency already blasts *inside* fills-by; this protects the
     *medium*-horizon shift that isn't urgent yet but could stack several slow leashes.)
  3. **Never surface the per-person value.** Spink owns the bounds, not the ticks. No outbox column, no
     board number, no "next ask in 37 min." The engine widening "when it's ready, within the bounds you
     set" *is* the no-babysitting promise. The moment the per-person leash becomes a number Spink reads,
     it's a glowing dashboard.

### File-by-file

- **`src/asks/response-latency.ts` (new).** `responseLeashMs(events, now, opts): number`.
  - Filter `events` to `ask_accepted` / `ask_declined` with a finite `metadata.latencyMs`, reuse the
    count-window logic from `reliability-score.ts` (`windowedEvents` / `resolveWindowCap`) so "recent"
    means the same thing both places.
  - If the in-window latency sample count `< MIN_LATENCY_SAMPLES` → return the flat default
    (`ASK_DRIP_INTERVAL_MINUTES * 60_000`). Else compute p75 of the samples.
  - Clamp to `[DRIP_LEASH_FLOOR_MS, DRIP_LEASH_CEILING_MS]`. Pure; `now` injected; all constants
    overridable per call (the tuning lever).
  - A sibling `leashForFrontier(repo, seat, now, opts)` that reads the most-recently-asked crew
    member's log via the port and returns their `responseLeashMs` — the thin bridge `tick.ts` calls.
- **`src/builder/derive.ts`.** Add the three tenant constants next to `ASK_DRIP_INTERVAL_MINUTES`,
  same env-helper pattern (`envPositiveInt` / `envNonNegativeInt`): `DRIP_LEASH_FLOOR_MINUTES`
  (default = today's 15, so an unset config reproduces current behavior as the floor),
  `DRIP_LEASH_CEILING_MINUTES` (default ~60), `MIN_LATENCY_SAMPLES` (default 3).
- **`src/builder/tick.ts`.** In the `for (const seat of seats)` widen block: when the seat is `Asked`
  and not on the `urgent` path, replace the single global `dripMs` handed to `widenDue` with the
  frontier candidate's resolved leash, then apply the `remainingHorizon / candidatesRemaining` clamp
  (`fillsBy` is already computed as `fillDeadlineFromEvents(...)`; `candidatesRemaining = unAsked.length`).
  Leave `widenDue`'s signature shape intact — it already takes a `dripMs`; just feed it a
  per-frontier value. `Open` seats still widen immediately (no leash on a freshly-reopened slot). The
  `dripMs === 0` blast-all rollback must still short-circuit the whole thing.
- **`src/asks/response-latency.test.ts` (new).** See "Done when."
- **`docs/DECISIONS.md`.** One DEC: latency drives **patience (the drip leash)**, never **priority
  (the score)**; per-candidate leash = mechanism, `[floor, ceiling]` bounds = tenant policy; clamped
  to fills-by so it can't overrun the horizon; min-sample fallback to the flat default; the per-person
  value is never surfaced. Note it as the patience/priority split that resolves the parked
  "latencyMs in the score" item, not a new spec feature.

### Gotchas / risks

- **Patience, not priority — hold the line.** The single rule that keeps this clean: latency never
  touches `reliability-score.ts`. This is also the anti-gaming mitigation — a crew member who answers
  slower gains *nothing*: the engine waits slightly longer before asking *other* people, their rank is
  unchanged, eligibility is unchanged. The score/leash split is itself the defense.
- **The horizon clamp is mandatory, not nice-to-have.** Without `min(leash, remainingHorizon /
  candidatesRemaining)`, a medium-horizon shift with several slow-leash candidates could exhaust its
  runway before the urgency-blast trips. Enforce it in the deriver; test it explicitly.
- **Min-sample fallback is the fluky-sample guard.** p75 over tiny n is unstable; one 6-hour outlier
  drags it. Below the sample floor → flat default. Above it, the ceiling caps the worst case anyway.
- **Frontier = most-recently-asked, not top-ranked.** The leash you wait is the patience owed to the
  person who holds the *latest* ask (the last widen), since that's who you're giving a chance before
  widening again. Read their log, not the seed candidate's.
- **Ghosters are already handled — don't double-count them.** A chronic never-responder logs
  `ask_ignored` (no `latencyMs`) → below sample floor → flat default leash; the existing
  `ASK_SILENT_TIMEOUT_MINUTES` (120) expires their ask. This idea's win is *lengthening* the leash for
  slow-but-answering crew, not shortening it for ghosters (the timeout owns that). Frame the value
  honestly.
- **Adjacent-but-distinct from the parked "learned ask time."** That parks *what hour to send the
  first ask* (a civil-window start time); this is *the interval between widenings*. Cousins, not the
  same — but if both ever ship, they're two per-crew learned-timing systems and should share the
  window/percentile helpers, not reimplement them.
- **Don't surface the number.** Repeat, because it's the difference between mechanism and anxiety
  theater: no per-person leash value in any operator or crew view.

### Done when

- `responseLeashMs` is pure (same events + same `now` ⇒ same ms), reads only, framework-free core.
- Tests (`src/asks/response-latency.test.ts`, in-memory repo):
  - **Below min-sample** (0, 1, 2 latency samples) → returns the flat default, exactly today's value.
  - **Slow-but-consistent responder** (e.g. five ~40-min latencies) → leash ≈ 40 min, **capped at the
    ceiling** if the ceiling is lower.
  - **Snappy responder** (five ~3-min latencies) → leash floored at `DRIP_LEASH_FLOOR`, not below.
  - **Fluky outlier** (four ~5-min + one 6-hour) → p75 stays near 5 min; the outlier doesn't dominate.
  - **Clamp** → a personal leash above `ceiling` clamps to ceiling; below `floor` clamps to floor.
  - **Horizon clamp** (deriver/tick level) → summed waits across a seat's remaining pool never exceed
    `fillsBy - now`; assert a long personal leash is shortened when the horizon is tight-but-not-urgent.
  - **`ASK_DRIP_INTERVAL_MINUTES = 0`** → blast-all path unchanged; no leash computed.
  - **Latency never affects rank** → a regression asserting `rankByReliability` output is identical
    with and without slow-latency history (the patience/priority firewall).
- `npm run verify` green (`typecheck` + `typecheck:app` + `test` + `build`).

### Kickoff

> Read `docs/tiller/2026-06-30-latency-leash.md`, `src/builder/derive.ts` (the
> `ASK_DRIP_INTERVAL_MINUTES` const + env helpers), `src/builder/tick.ts` (the `widenDue` gate and the
> `for (const seat of seats)` widen loop), `src/asks/ask-loop.ts` (`widenAsk`, `rankedEligible`), and
> `src/oracle/reliability-score.ts` (`windowedEvents` / `reliabilityEventsFor` — the read pattern to
> mirror) plus `src/domain/reliability.ts` (`metadata.latencyMs`). Build the latency-aware drip leash:
> a new pure `src/asks/response-latency.ts` (`responseLeashMs` = p75 of recent `latencyMs`, min-sample
> fallback to the flat default, clamped to tenant `[floor, ceiling]`) and wire it into `tick.ts` so the
> drip waits the **most-recently-asked candidate's** leash before widening past them, additionally
> clamped to `remainingHorizon / candidatesRemaining` so it can't overrun fills-by. Do **not** touch
> the reliability score — latency drives patience, never priority. Add the three tenant constants to
> `derive.ts`, write `response-latency.test.ts` including the horizon-clamp and rank-unchanged cases,
> and add one DEC. Plan it and poker it before cutting the branch, per the micro workflow.

---

*The Innovator checked tonight's radar and found no load-bearing outside-tech cross — the leash is a
deterministic computation over a log column in a DB-less core; the watchlist's sync/realtime items
become load-bearing only at a future crew-app I/O or persistence surface, not here. A quiet night on
the outside-tech axis, by design.*

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
