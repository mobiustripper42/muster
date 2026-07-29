---
id: DEC-061
title: "A winning \"in\" auto-confirms — `Claimed` is momentary on the happy path"
topic: "Seats, shifts & state machine"
amends:
  - id: DEC-007
    relation: retires
    scope: "the two-protocol fork only — nobody is \"named then confirmed\" by a human. The first-acceptable-yes-wins leg survives and is live (#561)"
amends_spec:
  - section: "2.4"
    scope: "the \"confirm down the list\" step is gone — a winning `in` auto-confirms, and `Claimed` is momentary on the happy path"
  - section: "2.6"
    scope: "the acceptance \"…and Spink confirming moves the seat\" is now automatic; \"In\" means committed, and a retraction is a penalized bail"
---

## DEC-061: A winning "in" auto-confirms — `Claimed` is momentary on the happy path

**Decision:** A winning accept advances `Asked → Claimed → Confirmed` in one operation. New core composition `recordResponseAndConfirm(repo, askId, response, now)` calls `recordResponse` (unchanged: CAS claim, reliability log, double-book/contested handling) and, **only when `outcome.claimed === true`**, calls the existing `confirmSeat`. Both answer surfaces route through it: crew `respondToAsk` and the operator-as-crew path (`recordResponseAs` → composition, ownership gate preserved). `recordResponse` and `confirmSeat` stay untouched (channel adapters, tests, and the manual cockpit confirm — now a vestigial backstop — depend on them). Applies to **both** protocols (DEC-007): the mate broadcast's first-yes and the named-captain's accept.
**Why:** The manual confirm ratified an already-decided CAS winner, never selected among yeses; for assign-then-confirm it was a redundant second confirmation of the person's own yes. Auto-confirm matches the operator's actual workflow (triage is nowhere near the per-shift cockpit confirm button) and the loop's documented intent ("the autonomous Tier-1 confirm of the first acceptable yes," `ask-loop.ts confirmSeat`). Operator-requested for the pilot (Eric, 2026-06-25): "in = they're on the boat."
**Tradeoff / supersedes:** Amends SPEC §2.4 (the "confirm down the list" step) and the §2.6 acceptance ("…and Spink confirming moves the seat"), now auto. `Claimed` becomes non-resting on the happy path; the crew "awaiting confirmation" affordance goes dark. **"In" now means committed** — a retraction is a penalized `bail()` (a `shift_bailed` reliability hit), not a free pre-confirm backout. The soft-commitment buffer, if ever wanted, remains the reserved `Held` tier (DEC-005), **not** a resting `Claimed`. Hard-codes first-acceptable-yes (DEC-007) — but does not worsen a future best-by-score flip, because the CAS claim already locks the first yes *before* any confirm step; the claim policy, not the confirm step, is the knob to change.
**Gotcha (M4):** the inbound SMS-reply adapter must funnel to `recordResponseAndConfirm`, **not** raw `recordResponse` — else real "in" texts strand at `Claimed` and silently reintroduce this bug. The channel-port comments (`ports/channel.ts`, `adapters/web-link-channel.ts`, `adapters/fake-channel.ts`) now say so.
**Revisit if:** Pass D adds the `Held` soft-hold tier, or DEC-007 flips to best-by-score.
