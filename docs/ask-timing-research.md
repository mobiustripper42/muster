# Ask-Timing Research — findings & what we did about it

Status: settled note · 2026-07-10. **Not a DEC** — a one-page record of a deep-research pass on
crew ask *timing* and the tweaks it produced, kept so we don't re-litigate it later. Source report:
the "When to Text Your Crew" deep-research artifact (Eric commissioned it; behavioral-science +
gig-platform + precarious-scheduling literature). The **decisions** it triggered live in
`DECISIONS.md` (DEC-097, DEC-098); this is the *why* and the scorecard.

## The question
When should the engine fire a crew ask? Is there a best send-time, and did Muster's design get it
right?

## What the research actually says (the load-bearing bits)
- **The willing reply almost instantly; response is bimodal — fast or never.** In the one clean
  real-world dataset (~23k shift-notification response times), the willing answer in ~1 minute; SMS
  is read within ~3 min. The channel is never the bottleneck — *state* is (are they in a position to
  say yes).
- **Off-days beat work-days** for a reflective "yes"; asking someone mid-task gets a reflexive
  "later" that becomes "never."
- **~5-day lead is the peak.** Longer leads flake monotonically (medical no-show curves: 8% → 16% →
  22% at 0-3 / 4-6 / 28-30 days). Shorter and the good crew are already booked.
- **Considerate timing is a cheap retention/fairness signal** (POS literature) — not "be nice → work
  harder," but "don't text people at bad moments → they quit less."
- **Day-before confirmation** ("reply Y") is the single highest-evidence no-show reducer
  (implementation intentions, d=0.65 across 94 studies).
- **At n≈15-30 you cannot A/B reply-rate.** Measure *time-to-reply* (continuous), within-subject
  crossover, Bayesian eyeballing. You'll only ever see large effects.

## The reframe (why the research is mostly answering a question we don't have)
The report optimizes **"when do I send the one blast?"** — written for a human with a broadcast SMS
list. Muster isn't that. We ask **autonomously, per-person, in reliability order, within a civil
window, with a self-serve pull surface underneath.** Most of the report's advice (pick Monday 9:30)
is a population *prior* we can beat with our own latency logs. The lead-vs-flake tension it spends
pages resolving, our architecture sidesteps.

## Scorecard — did we nail it?
**At or ahead of the research (already built):**
- **Pull-first self-service** (`/crew/open`, DEC-074/076/077) — the report doesn't imagine this; the
  willing claim on *their* receptivity, zero push.
- **Reliability-ordered asking** (the ranked drip) — a whole *whom* dimension the report is silent on.
- **Considerate timing as structure** — civil window (DEC-088, 08:00-20:00) + on-shift suppression
  (DEC-098) make "never text at a bad moment" a hard constraint, not a human remembering.
- **Autonomous escalation** (drip → Tier-2 → board) — the report assumes a person sends.

**Where the ideal goes further — and our call on each:**
- **Per-person learned send-time** (JITAI posterior) — *parked, needs data.* We log latency day-one
  (DEC-008); the learning layer is the FUTURE_IDEAS "per-crew preferred / learned ask time" row.
- **Day-before confirmation / two-stage commitment** — *deliberately not built.* It's the report's
  biggest no-show lever, but DEC-061 chose "in = committed" for one-touch simplicity, no-shows aren't
  a felt problem (zero misses to date), and calendar integration covers shift-*awareness*. Stays
  parked as Pass D (progressive commitment, SPEC §4). Revisit only if no-shows appear.

## What we decided (2026-07-10) — tracked as issues, not yet built
Decisions are settled (dials and all); the code is filed as GitHub issues, not written yet.
1. **`STAFFING_HORIZON_LEAD_DAYS` 7 → 5** (#340). Dead on the research peak, and not by luck: the ask fires
   at `trip_start − leadDays`, and over a Wed-Sun trip week the day-of-week map is a bijection, so at
   most 2 of 5 trip-days can land on the Mon/Tue rest days. **5 hits that optimum** — Sat/Sun trips
   (the busy days) ask on Mon/Tue, when nobody works — and **7 is the worst** value (each ask lands on
   the same weekday+hour a week earlier, maximally aligned with a weekly-recurring shift). No
   fractional value beats it: the fraction only slides the time-of-day, and the fleet blankets the
   civil daytime, so it swaps which crew get hit rather than opening a gap. **Horizon tuning cannot
   dodge the mid-shift collision; only per-recipient suppression can** → DEC-098.
2. **DEC-098 — on-shift ask suppression** (#341). If a crew member is inside their own live committed shift
   (`[call, end)`), the engine doesn't auto-ask them. Covers the Wed/Thu/Fri trips that lead=5 still
   lands on working days. Defer-don't-drop, no penalty.
3. **DEC-097 — same-day decline cooldown** (#342). A "no" for a date stops further *auto*-asks that day
   (self-claim stays open); closes the "everybody asked, nobody spammed" gap. Dial: suppress the
   whole date, with a last-resort valve (re-ask a decliner only if the seat would otherwise board).
4. **Drip interval — flagged, decision open** (#343). The research's "fast or never" argues for a ~2-3 min
   widen (don't give a ghosting top-pick a 15-min exclusive hold). But the drip is **gated by the
   tick cron** (`*/15`), so lowering `ASK_DRIP_INTERVAL_MINUTES` alone is inert — a couple-minute
   widen means ticking the whole engine ~7.5× as often. Left as an open cost/benefit call: far-out
   shifts have no urgency and near-term ones already blast, so the practical upside is small.

## The one measurement that matters
Two months of clean `Ask.respondedAt` latency logs will tell us more about *our* crew than the whole
report. That's the input to the parked per-person learned send-time — the research's own closing line.
