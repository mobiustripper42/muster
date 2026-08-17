---
id: DEC-116
title: "Weekend-batch staffing trigger — Fri/Sat/Sun shifts go live together on one weekday + time (#392)"
topic: "Staffing engine — asks, escalation, At-Risk board & cockpit"
---

## DEC-116: Weekend-batch staffing trigger — Fri/Sat/Sun shifts go live together on one weekday + time (#392)

**See also** — later decisions that changed part of this one:
- Refined by DEC-117

**Status:** Decided 2026-07-13 (Eric + @architect). Extends the horizon family DEC-022/062; same gating posture
as DEC-088 (decouple ask send-time from the trip's clock) — now on the **day** axis, not just the hour.

**Context.** The flat per-shift horizon (`start − STAFFING_HORIZON_LEAD_DAYS`, DEC-022/062) brings each weekend
shift live as its own lead passes — Fri, Sat, Sun trickle in on three different days. The operator wants the
whole weekend's shifts to go live **together** on one trigger (Monday 09:00 the week prior), so crewing the
weekend is a single event, not three.

**Decision.** A trip whose **vessel-local weekday** ∈ `STAFFING_HORIZON_WEEKEND_DAYS` computes a **shared
trigger instant** — that week's `STAFFING_HORIZON_TRIGGER_DAY` at `STAFFING_HORIZON_WEEKEND_ASK_TIME` — instead
of `start − leadDays`, so all of Fri/Sat/Sun collapse onto one send. Every non-weekend trip-day keeps the flat
lead. Folded into `staffingHorizonFromEvents` (`src/builder/derive.ts`) — the single seam all six horizon call
sites funnel through — as an optional `cohort` param defaulting to the env-built `WEEKEND_COHORT_POLICY`;
consumers take a resolved `Date | null` and are unchanged. `bailLatenessMs` reads the raw lead directly and is
**not** cohort-ified (its `leadMs` is a penalty clamp, not the horizon).

- **Weekday from `vesselDateOf`**, never `getUTCDay` on the raw departure instant — an 8pm-Eastern Sunday trip
  is Monday 00:00 UTC and would misclassify (DEC-032-class). The Mon-zero weekday `(getUTCDay+6)%7` doubles as
  the day-offset back to that week's Monday.
- **Three env knobs**, poison-resistant (bad value → default/off, never throws — a config throw kills the
  cron): `STAFFING_HORIZON_WEEKEND_DAYS` (space-list of Mon=0…Sun=6 → validated set; **empty/unset = off =
  flat**, the backward-compat / other-tenant default), `STAFFING_HORIZON_TRIGGER_DAY` (bounded int 0–6, default
  0 = Monday; only 0 and 6 are sensible), `STAFFING_HORIZON_WEEKEND_ASK_TIME` (HH:MM, reuses `envWallClock`,
  default 09:00). `STAFFING_HORIZON_LEAD_DAYS` keeps its name; its meaning is now "the non-cohort lead."

**Ships inert.** With `STAFFING_HORIZON_WEEKEND_DAYS` unset in prod, no trip is a weekend trip ⇒ behaviour is
byte-identical to today. The env flip is **deferred until the ask-distribution fix (#393, DEC-117) lands** —
otherwise the first weekend after go-live batches all its shifts to one instant and blasts the top captain N
simultaneous asks. The env var is the single go-live lever for both.

**Relationship:** extends DEC-022/062; sibling gating posture to DEC-088. The batched weekend is the unit
#393/DEC-117 pushes over. **Revisit if:** a non-weekend batch trigger (holidays) is wanted — the
`WEEKEND_DAYS`/`TRIGGER_DAY` shape generalizes to any set-of-days.
