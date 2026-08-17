---
id: DEC-117
title: "Weekend-batch ask distribution — one text per person, one boat per day (#393)"
topic: "Staffing engine — asks, escalation, At-Risk board & cockpit"
---

## DEC-117: Weekend-batch ask distribution — one text per person, one boat per day (#393)

**See also** — decisions this one changed part of:
- Refines DEC-116

**Status:** Decided 2026-07-13 (Eric + @architect, rescoped). The ask-distribution fix DEC-116's env flip
waits on. Supersedes #393's original "turn-based push / round-robin matcher" framing — Muster's existing In/Out
asks + reliability drip + the always-open `/crew` board already ARE the mechanism; only two gaps needed closing.

**Context.** When DEC-116 batches a weekend's shifts live at one instant, the per-seat drip (DEC-063) would
(a) fire the top captain one ask PER open seat — up to N simultaneous texts — and (b) seed that same captain
for every same-day boat, since each seat picks its #1 independently. Both are the "hammer your best person"
failure the batch would otherwise create.

**Decision — two targeted fixes to the existing ask path, no new primitive:**

1. **One text, not N (per-recipient batching).** `forwardAsks` (`src/adapters/forward-asks.ts`) groups a tick's
   fired asks by recipient: a crew member who drew several gets ONE message ("Muster: N shifts need you. Tap to
   answer.") whose crew-scoped magic link lands on `/crew`, which already renders all their live asks as In/Out.
   Only *delivery* is coalesced — the per-ask domain records are untouched and all show on `/crew`. This is the
   module's missing idempotency net: one send per (recipient, tick), the tick fires each ask once. Applies to
   ALL asks, not just the batch — nobody should ever get a pile of simultaneous ask-texts.

2. **One boat per day (drip seed dedup).** A crew member works at most one boat per vessel-local day (the
   existing `/crew/open` rule), so the drip must not seed them for a second same-day boat. `widenAsk` gains an
   optional `exclude` set; `tick` builds a per-day map of who holds a live ask that day (pre-seeded from
   existing live asks so cross-tick widens respect it too) and passes it, marking each fired crew. Same-day
   boats spread across people — boat-A→best, boat-B→next, boat-C→next — instead of all seeding the top captain.
   **Drip only:** the urgent blast (inside the fill deadline, DEC-031) fills at all costs and does NOT exclude —
   urgency overrides spreading, mirroring how it already overrides drip pacing. Crew choice is preserved by the
   always-open `/crew/open` board (they can grab a different same-day boat themselves).

**Relationship:** the distribution fix DEC-116's rollout waits on; reuses `/crew`, the drip (DEC-063),
first-acceptable-yes-wins (DEC-007), `rankedEligible`. **Revisit if:** the round-robin/turn-queue idea returns
(rejected here as over-built — the drip + board already spread and give choice).
