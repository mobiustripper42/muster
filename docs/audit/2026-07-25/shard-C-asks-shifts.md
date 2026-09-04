# Shard C — Asks / shifts / derived state

**Subject:** the behavioral substrate — shift/seat state machine, escalation tiers, the availability
oracle, the reliability score, and the user stories that ride them.

**Audited tree:** `main` @ `5a66e51`.

> **Which-tree check (lesson 4).** `USER_STORIES.md` is byte-identical across both trees, and
> `src/oracle/**` has a **zero-line diff** between `main` and `feature/reservations` — the whole
> asks/shifts core is tree-independent. `SPEC.md` differs by 13 lines, and **that difference is our
> own PR #538**, which landed the shard-A owner-decision fix on `feature/reservations` only. See C2.

**Primary docs:** `docs/SPEC.md` §0.2, §1.1–§1.4; `docs/USER_STORIES.md`.
**Checked against:** `src/domain/states.ts`, `src/oracle/{eligibility,oracle,reliability-score}.ts`,
`db/migrations/0022_drop_shifts_locked_at.sql`, `src/adapters/*`.

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| C1 | `USER_STORIES.md:26` (SP-6) | "I **lock** a reviewed shift so crewing may proceed; inside the staffing horizon, locking fires the asks." | Lock was **cut**. `SPEC.md:47` strikes it through — "*(Lock cut — DEC-082.)*"; `0022_drop_shifts_locked_at.sql` drops the column ("Locking was CUT"); **zero** `lockedAt`/`locked_at`/`lockShift` references in `src/` or `app/` | CODE-CONTRADICTS | doc-wrong |
| C2 | `USER_STORIES.md:28` (SP-7) | "When a late booking lands on a **locked** shift, I get a 'changed since you reviewed it' nudge" | Same as C1 — the story's precondition cannot occur | CODE-CONTRADICTS | doc-wrong |
| C3 | `USER_STORIES.md:86` (DR-1) | "I decide deposit-vs-full and the refund schedule. *(parked — payments are 2027)*" | DEC-105 (2026-07-11) reopened payments **for 2026**; DEC-107 **decided** deposit + balance; Phase 11 shipped it. `SPEC.md:59-64` already carries the DEC-105 reopening | MISMATCH | doc-wrong |
| C4 | `SPEC.md:304-316` (§1.3 rule list) | Property rules (booking horizon): "vessel not double-booked · COI valid on date · **pax ≤ COI max** · not in maintenance/haul-out · lead-time cutoff · min/max pax · within season · within daily hours · blackout dates · turnaround buffer" | **None implemented as oracle rules.** `EligibilityRuleId` is six crew rules only (`is_active`, `has_rating`, `mmc_valid_on_date`, `not_double_booked`, `not_on_pto`, `not_recurring_off`). `coiMaxPax` exists as a vessel field with no rule. DEC-112 routes the booking path *around* it: party cap reads `Event.capacity`, "**no** new `Vessel.coiMaxPax` lookup in the customer path" | MISMATCH | **decision** |
| C5 | `SPEC.md:293-303` (§1.3) | The `Verdict` object sketch — `{ bookable, status, failures, deferred, recheckBy }` — and the two evaluation modes, `first-fail` / `collect-all` | No `Verdict` type anywhere in `src/`; no first-fail/collect-all mode parameter. `eligibility.ts` returns a per-candidate `RuleResult[]`, a different shape | MISMATCH | **decision** |
| C6 | `SPEC.md:248` (§1.3 rule contract) | "`severity`: **hard** (blocks) or **soft** (warns; tenant can downgrade a rule to warn-only)." | `RuleResult.severity` is the **literal type `"hard"`** (`eligibility.ts:62`), not a union — soft is *unrepresentable*, not merely unused. The tenant downgrade mechanism does not exist | MISMATCH | **decision** |

## RESOLVED 2026-07-25 — C4/C5/C6 closed by DEC-138

The decision this shard escalated has been made. **SPEC §1.3 is rewritten to the DEC-125 model**
(PR #540, into `feature/reservations`): two mechanisms, not one rule engine. C4–C6 are **no longer
open** — they resolve to *superseded*, not *unbuilt*.

Two corrections to what is written below, both mine:

1. **C4's "None implemented as oracle rules" is literally true but overstated the gap.** It is
   accurate that no *oracle* rule implements them — but DEC-125's virtual availability implements
   most of the same **function** as set subtraction: season and daily hours in the schedule term,
   haul-out and blackouts as `Block` variants, vessel-double-booking as the slot-identity guardrail,
   pax-vs-COI in `canBook`. Actual coverage was **6 of 10 covered, 2 partial, 2 absent** — not zero.
   The severity read below should be read with that correction in front of it.
2. **Both "absent" rules were then rejected on operator input, and neither should be built:**
   - **COI valid on date** — I proposed this as the one with teeth. Wrong. Inspection is scheduled
     and passed; the failure mode it guards is one where a Muster banner is the least of the
     operator's problems. The asymmetry with `mmc_valid_on_date` is correct, not an oversight.
   - **Lead-time cutoff** — also wrong, and worse: it would have **blocked SPEC §1.2's emergent
     last-minute booking**, which the spec treats as the payoff. The safer shape (hold the slot,
     find crew, then confirm) was *already parked* as "Smart same-day booking" (2026-06-11, Drew) —
     I missed it on first search because it isn't filed under "short-notice."

Both rejections are recorded in DEC-138 so they are not re-raised.

**Lesson for later shards:** when a spec section describes machinery that appears absent, check
whether the *function* moved to a different mechanism before reporting a gap. Grep the vocabulary of
the shipped design, not only the vocabulary of the spec.

## Severity read

**C1/C2 are the clear-cut ones and the cheapest to fix.** Two of Eric's fourteen stories describe
shift *locking* — a feature that was cut (DEC-082), whose column was dropped by a migration that
says so in its header, and which has no code references at all. `SPEC.md` already records the cut
with a strikethrough; `USER_STORIES.md` never got the same treatment. Anyone using the story list as
a build or acceptance checklist would try to build a cut feature.

*Note for whoever fixes it:* SP-16's "a self-claim **locks the seat** immediately" is a **different
sense** of the word — seat commitment, not shift review-lock — and is correct. Don't sweep it up.

**C3 is the `main`-side twin of shard A's A4.** Shard A fixed SPEC's stale owner-decision list, but
that fix landed on `feature/reservations` (PR #538), because the DECs it cites live only there.
`USER_STORIES.md` carries the same staleness on `main` and was outside shard A's corpus. Worth
fixing here rather than waiting for merge-back.

**C4/C5/C6 are one finding wearing three hats, and it is a decision, not a typo.** §1.3 specifies a
booking oracle: two horizons, a `deferred` verdict class, property rules gating the sale, a rule
contract with soft severity, and a `Verdict` object. What exists is a **crew-eligibility filter** —
six hard rules answering "who can be asked." That is not drift; it is the half of §1.3 the project
actually needed, because **Xola gates bookings today** (DEC-105) and the Muster booking path that
does exist (`feature/reservations` `availability.ts`) is a whole-boat mutex over `Event.capacity`,
which DEC-112 chose *explicitly over* the COI property rule.

So the question §1.3 raises is not "why is this unimplemented" but **"is this still the plan?"** —
and that is the operator's call, not a doc edit:

- If **yes**, §1.3 is a forward spec and should say so, the way §1.1 says `Held` is reserved and
  §1.2 says the confirm step is superseded. Right now it reads as a description of what exists.
- If **no** — if the reservations availability model supersedes it — §1.3's property-rule list needs
  the same supersession banner DEC-107 just got, pointing at DEC-112/DEC-106.

I have not proposed which. **Do not "fix" C4–C6 by editing the rule list** — that would bury a real
architectural question under a doc tidy.

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | source | verified against |
|---|---|---|
| 6 shift states — Pending / Filling / Crewed / At-Risk / Completed / Cancelled | `SPEC.md:146-153` | `src/domain/states.ts:11-18` — exact match (code spells it `AtRisk`; SPEC uses the display form) |
| 5 seat states — Open / Asked / Claimed / Confirmed / Bailed | `SPEC.md:159-166` | `states.ts:33-40` — exact match |
| `Held` reserved between `Claimed` and `Confirmed`, deliberately absent from v1 | `SPEC.md:168-174` (DEC-005) | `states.ts:24-37` — the insertion point is marked in a comment at exactly that position |
| Supernumerary seats don't gate `Crewed` | `SPEC.md:150` | `states.ts:13`, `SEAT_KINDS` at `:45` |
| Reliability: Out **+1**, In **+2** (DEC-120 supersession) | `SPEC.md:349-351` | `reliability-score.ts:26,79-81` — `ask_accepted +2`, `ask_declined +1`, `ask_ignored −3`, `shift_acknowledged +1` |
| Acknowledgment weight capped below `shift_completed` | `SPEC.md:361` | `reliability-score.ts:79-80` — ack `+1` < accepted `+2` |
| Crew satisfiability "collapses into a filter on *who gets asked*" | `SPEC.md:190-194` | Matches `eligibility.ts` exactly — SPEC states the collapse itself, so the absent composite solver is **not** a gap |
| §1.2 supersession pointers are correct and present | `SPEC.md:224-236` | DEC-061 (auto-confirm) and DEC-063 (drip) are both flagged inline — **this is the pattern DEC-107 lacked** |
| SP-16 "self-claim locks the seat" | `USER_STORIES.md:55` | Seat commitment, unrelated to DEC-082 shift lock. Correct as written |

## Coverage — what this shard did and did not read

Stated plainly, because "did we get everything?" is a fair question and the honest answer is *no
sweep of this kind is exhaustive*:

- **Read in full:** `USER_STORIES.md` (all 88 lines, all 3 role sections), `SPEC.md` §0.2, §1.1,
  §1.2, §1.3, §1.4 (lines 41–398), `src/domain/states.ts`, `eligibility.ts` rule ids + `RuleResult`.
- **Grep-verified, not read in full:** `reliability-score.ts` (weights only), `oracle.ts`,
  `claimable.ts`, `reliability-log.ts`, `audit-log.ts`.
- **Not read:** `SPEC.md` §2.x **surface specs** (roughly lines 398–1100 — Roster, Event Admin,
  Shift Builder, Assignment View, At-Risk Board, Crew App), each with its own *States to render /
  Actions / Data read / Edge cases / Acceptance criteria* blocks. **This is the largest unswept
  area in the project's doc set** and is where per-surface drift would hide. It is a shard of its
  own, not a tail on this one.
- **Not read:** `src/builder/**`, `src/crewapp/**`, `src/admin/**` — the surfaces those §2.x
  sections describe.

**Recommendation:** add a **shard C2 — §2.x surface acceptance criteria**. It is ~700 doc lines
against three source directories, and on the shard-F pattern (finding volume, not corpus size, is
what exhausts a window) it wants the ledger-on-disk sweep-agent treatment rather than an in-context
pass like this one.

## Cost

In-context. Cheaper than shard F, more than A or B — the state-machine and reliability checks were
quick greps, but §1.3 needed the oracle read carefully enough to be confident the property rules are
genuinely absent rather than living under a different name.
