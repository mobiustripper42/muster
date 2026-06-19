# Tiller: The recovery list — turn the board's dead end into the cheapest unblock

> 🌙 **Tiller** — overnight idea, one per visit. Draft, never auto-merge. Eric is the gate.

## The pitch

### The idea

The oracle already computes, for **every** crew candidate against **every** required seat, a
structured `CandidateVerdict` — `eligible`, or a list of failing rules with payloads (`mmc_valid_on_date`
with the held credential's expiry, `not_double_booked` with the conflict date, `not_on_pto` with the
window, `is_active`, `has_rating`). `eligiblePool` *returns all of them* — the eligible **and** the
failed. Today the failures are spent on one thing: **transparency** ("why each person failed"). When a
shift exhausts its eligible pool and lands on the At-Risk board, the board shows what's missing and
*who's still eligible* — and the **ineligible** crew become a closed door.

The recovery list mines that closed door. For a shift already on the board, take the ineligible
candidates for the gap role, rank them by **how close to eligible** they are (fewest failing rules
first) and then by **how cheap the single blocker is to clear**, and surface the cheapest unblock as a
suggestion on the row:

- *"Liam's MMC expired 2026-06-15 — 4 days before the trip. Verify/renew?"* (one phone call)
- *"Sam is on PTO Jun 19–21 — ask anyway?"* (one override; PTO is suppression-only)
- *"Pat is marked inactive — reactivate?"* (one toggle)
- *"Dana is the body, but she's double-booked on Boat 1 that day — freeing her crews this."* (a
  reassignment the operator weighs — named, **not** auto-solved)

Every "no" becomes a priced "not yet." The engine proposes the lever; the operator pulls it.

### Why it's worth it

Muster's reason to exist is "Xola knows a booking is paid; Muster knows whether anyone will be
standing on the dock." The At-Risk board is where that knowledge lands — and right now, when the pool
is truly exhausted, the board's honest answer is a wall: *"short a captain, nobody available."* For a
semi-retired operator whose entire design goal is **no babysitting**, that's the one moment the engine
goes quiet exactly when Spink needs it most. But the engine isn't actually out of information — it's
out of *eligible* people, which is not the same thing. It knows Liam would be in if his MMC weren't
four days lapsed; it knows Dana is a body who's merely committed elsewhere; it knows Sam is only
suppressed by a PTO window Spink himself set. That's the difference between *"I'm cancelling a paid
trip"* and *"I make one phone call."* The leverage is enormous and the cost is nearly nil: the data is
**already computed and already returned** — we are simply refusing to throw the near-misses away.

### Why he hasn't already

The failure verdicts were built as **explanation**, not as an **action queue**. The mental model of
the pool is binary — eligible / not — and the board was deliberately built to surface the *eligible*
side ("who's still available") and the *shift* side ("what's missing"). Flipping the *ineligible* side
into "sorted by closeness, cheapest lever first" is a conceptual move nobody made, because every lever
is a **policy / judgment** call — override a PTO, reactivate a person, vouch for a lapsed credential,
rob one boat to crew another — and the build has rigorously kept the engine **out of policy** (DEC-001)
and the board **free of anxiety-theater** (§2.5). "Suggest the cheapest override" *felt* like the
engine overstepping. The unlock is the same one DEC-001 already encodes: **suggesting** the lever isn't
**pulling** it. The recovery list is mechanism; the operator disposes. (It's also the natural mate of
the credential-expiry nudge already shipped at 4.5 — but pointed the *opposite* direction: 4.5 warns
about crew **already in seats** whose creds will lapse; recovery surfaces crew **out of the pool** whom
one fix would bring *in*.)

This is a new **consumer of existing engine output** — the same shape the build already blesses — not
a new feature in the locked spec.

---

## The build handoff

### Approach

- **A pure deriver, no new engine state.** It reads `CandidateVerdict.failures` — which `eligiblePool`
  already returns for every candidate on every required seat — and produces a small ranked list of
  recovery options per stuck shift. No new repo reads it doesn't already have; `now` injected; lives in
  the framework-free admin core; Vitest-tested in isolation.
- **It attaches ONLY to shifts already on the board.** It does **not** create a new push surface and
  does **not** warn on healthy `Crewed` shifts (that's the "warming/SPOF" anxiety dashboard the spec
  deliberately refuses — §2.5). It enriches the existing dead-end row, nothing more. This is the line
  that keeps it on-ethos.
- **Rank by closeness, then fixability cost.** Primary key: fewest failing rules (closest to eligible).
  Secondary key: a static cost-order over the blocker's `ruleId`:
  1. `not_on_pto` → **override / ask-anyway** (cheapest — PTO is suppression-only, DEC-009; Spink set it,
     Spink can decide it's soft for this ask).
  2. `is_active` → **reactivate** (one roster toggle).
  3. `mmc_valid_on_date` → **verify/renew** (a phone call — surface the expiry date and the days-before-
     trip gap so the operator judges renewal-in-flight vs hard-expired).
  4. `not_double_booked` → **named pointer only** (a reassignment; see the containment rule below).
- **`has_rating` is not recoverable — exclude it.** You can't grant a captain's licence overnight. A
  candidate whose blockers include `has_rating` is dropped from the recovery list (or marked
  non-actionable), not offered as a fix.
- **Suggestion-only (DEC-001).** v1 ships the *deriver + the board line* (the engine proposing). Wiring
  each lever to a one-click action (reactivate-here, ask-anyway, mark-cred-verified) is a deliberate
  fast-follow so this PR stays contained and never auto-mutates policy.

### File-by-file

- **`src/admin/recovery.ts` (new).** The pure deriver.
  - `deriveRecovery(repo, shiftId, now): Promise<RecoveryOption[]>` — or a pure
    `recoveryFromPools(pools, crewById): RecoveryOption[]` that takes the `SeatPool[]` `eligiblePool`
    already computes, so the board deriver can hand its pools straight in without a second oracle pass.
  - Gather the **failed** verdicts for the shift's **gap** seats (the required seats still open). For
    each ineligible crew member, **dedup across same-role gap seats** and keep their *best* (fewest-
    failure) verdict. Drop anyone with a `has_rating` blocker. Map the remaining blocker(s) to a lever
    via the cost-order, rank, cap at the top few.
  - `export interface RecoveryOption { crewMemberId; name; role; blockers: EligibilityRuleId[];
    lever: { kind: "override_pto" | "reactivate" | "verify_credential" | "free_double_booked";
    detail: Record<string, unknown> }; cost: "override" | "toggle" | "call" | "reassign"; recoverable:
    boolean }` — `detail` carries codes/ids (expiry date, PTO window, the conflicting shiftId), never
    prose; the UI maps to copy (mirrors the DEC-026 "ids not prose on trusted surfaces" rule).
- **`src/admin/at-risk-board.ts`.** Attach `recovery: RecoveryOption[]` to each `AtRiskRow`, computed
  from the pools the row already solves over (no extra `eligiblePool` call). Keep the deriver
  recompute-on-read — never stored (the DEC-022/023 corollary the board already honors).
- **`components/at-risk/risk-row.tsx`.** Add a "**Closest to crewed**" sub-line under the existing
  "who's still available" block, rendering each `RecoveryOption` as `lever + honest cost`. Server
  component, **no client JS** — exactly as the row is today. v1 lines are read-only suggestions (the
  one-click lever actions are the fast-follow).
- **`src/admin/recovery.test.ts` (new).** See "Done when."
- **`src/admin/index.ts`.** Barrel-export `deriveRecovery` / `RecoveryOption`.
- **`docs/DECISIONS.md`.** One DEC: "recovery list = a data-independent, suggestion-only consumer of the
  oracle's failure verdicts; attaches to board shifts only (not a warming surface); `not_double_booked`
  is surfaced as a pointer, never solved cross-shift (that's the parked swap-finder); `has_rating` is
  non-recoverable. Mechanism proposes, operator disposes (DEC-001)."

### Gotchas / risks

- **Reuse the verdicts — don't re-run eligibility.** `eligiblePool` already returns each candidate's
  `failures`. Re-deriving them is wasted work and a second source of truth. Take the pools the board
  already has.
- **The `not_double_booked` containment rule (the load-bearing one).** Surface it as a **named,
  un-costed pointer** — "double-booked against shift X on Boat Y that day; freeing them crews this" —
  and **stop**. Do **not** call `solveShift`, do **not** compute the reassignment, do **not** query the
  other shift's pool. The moment you solve "who covers Boat 1 if Dana moves" you've built cross-shift
  matching — that's the parked **swap-finder** and the territory of the already-pitched crewability
  forecast (#37). The recovery deriver *describes*; it never reaches across shifts to act. Keeping this
  capped is what keeps the module pure, per-shift, and distinct.
- **Anti-anxiety boundary.** Attach only to shifts the board already summons. No new push, no warning on
  healthy shifts — otherwise it becomes the SPOF/warming dashboard §2.5 refuses.
- **`has_rating` exclusion.** Don't offer "grant a licence." Drop these candidates from recovery.
- **Dedup per crew, best verdict.** A crew member can fail on multiple gap seats of the same role; count
  them once at their fewest-failure verdict, or you'll rank a single person several times.
- **Dates are advisory here, not a gate.** The eligibility gate already ran (these people are *out*).
  "MMC expired DATE, N days before trip" is a days-grained explanation — mirror `credential-health.ts`'s
  advisory grain and reuse the `iso-date` helpers; don't reintroduce a date-exact comparison.
- **Suggestion-only.** No auto-override of PTO, no auto-reactivate. The engine proposes; v1 does not pull
  the lever.

### Done when

- `deriveRecovery` (and/or `recoveryFromPools`) is pure (same repo state + `now` ⇒ same result), reads
  only, lives in the framework-free admin core.
- Tests in `src/admin/recovery.test.ts` (in-memory repo):
  - **PTO-only blocker** → top option, lever `override_pto` with the window, cost `override`.
  - **Inactive-only** → lever `reactivate`, cost `toggle`.
  - **Lapsed-MMC-only** → lever `verify_credential` with expiry date + days-before-trip; cost `call`.
  - **Double-booked-only** → lever `free_double_booked` naming the conflicting shiftId; **assert no
    reassignment is computed** (the deriver makes no second-shift pool query / no `solveShift` call).
  - **`has_rating` blocker** → candidate **excluded** from the recovery list (not offered).
  - **Closeness ranking** → a one-blocker candidate ranks above a two-blocker candidate.
  - **On-ethos boundary** → a healthy `Crewed` shift (not on the board) yields no recovery list / no new
    surface.
- `npm run verify` green (`typecheck` + `typecheck:app` + `test` + `build`).

### Kickoff

> Read `docs/tiller/2026-06-19-recovery-list.md`, `src/oracle/eligibility.ts`, `src/oracle/oracle.ts`
> (note `eligiblePool` already returns every candidate's `failures`), `src/admin/at-risk-board.ts`, and
> `components/at-risk/risk-row.tsx`. Build the recovery list as specced there: a pure
> `src/admin/recovery.ts` that mines the oracle's failure verdicts for an at-risk shift, ranks
> ineligible crew by closeness-to-eligible then a fixability cost-order over `ruleId`, and emits a
> small ranked `RecoveryOption[]`; attach it to `AtRiskRow` (reuse the pools the board already solves)
> and render a "Closest to crewed" sub-line on `risk-row.tsx` (server component, no client JS,
> suggestion-only). **Cap `not_double_booked` at a named pointer — no cross-shift solving**, exclude
> `has_rating`. Plan it and poker it before cutting the branch, per the micro workflow.

---

*The Innovator checked tonight's radar against this idea and found no load-bearing outside-tech cross:
the recovery deriver is pure domain logic over verdicts the engine already computes. (Local-first sync —
Zero/ElectricSQL/PGlite — does genuinely cross Muster's marine-offline reality, but at the crew-app I/O
layer, not this engine idea; it's an infra bet that wants its own spec, flagged on-radar rather than
bolted on tonight.)*
