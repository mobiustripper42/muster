---
id: DEC-158
title: "A change notice names what moved — the SMS carries a subset, the app carries all of it"
topic: "Outbound notifications & operator relay"
---

## DEC-158: A change notice names what moved — the SMS carries a subset, the app carries all of it

**Status:** Decided 2026-08-17 (operator: Eric; #740). Half built in the same task; the crew-app half deferred, deliberately and with its design settled here rather than left open.

**Context.** `"your Fri Aug 14 - Brew 3 shift changed - check the app."` was the entire notice. It named the shift and said something moved, never what — a call time sliding 90 minutes earlier and a fourth trip appearing produced byte-identical text. The crew member opened the app, saw a shift, and had to remember what the day used to look like to spot the difference.

The other two assignment notices don't have this problem because they have nothing to describe: `you're off the … shift.` and `you're on the … shift.` are complete on their own. **`changed` was the only one naming an event without naming its content.**

The diff existed and was discarded. `formShifts` decided a shift had changed by comparing the old trip set against the new one, held both at that moment, and pushed only `{ shiftId, crewMemberId }` — so every layer downstream was left describing a change it could no longer see.

---

**Decision 1 — the notice carries the diff, computed once, at the only place that can see it.**

`changedCrew` entries carry `{ added, removed, startBefore, startAfter }`. Nothing downstream reconstructs the diff: by the time a notice is composed the database has already moved on, and anything recomputing it is guessing.

**Decision 2 — two things count as a change: the trip set, and the earliest departure.**

The trigger was trip-set-only. DEC-029 said time changes were caught for free, and under its scheme they were — event identity was `evt-${vesselId}-${date}-${time}`, so moving a trip minted a new id. **DEC-043 replaced that with Xola's real `event.id`** and nobody re-checked: a retime that keeps its id leaves the set identical, the gate sees nothing, and the crew are never told their call time moved. That gap was characterised and left open for months.

It stopped being an open question when Muster began selling its own reservations — whatever Xola does with ids, Muster controls its own, and an operator retiming a departure in place is an ordinary act. Operator, 2026-08-17: *"if the time changes and the crew isn't notified, then that's a bug."*

So `Shift` carries `earliestStart`, a **change-detection watermark**. Times remain derived, never stored (DEC-022); everything that *renders* a departure or call time still derives it from the events. The watermark does the one job events cannot: `formShifts` compares against the **stored** shift, and a value recomputed from scratch each run has nothing to compare against.

**Nullable, never backfilled.** A pre-migration row reads absent, which means **unknown** and is explicitly not a change. Backfilling would either be wrong — we don't know what the earliest start was when the row was last formed — or, computed from today's events, would make every existing shift announce a retime that never happened on the first form after deploy. That form is a cron tick, so the false alarm would be fleet-wide and at whatever hour the tick runs.

**Decision 3 — the SMS is a strict subset of the app; the app is always complete.**

The body is GSM-7 and one segment on purpose, and #619 was already bitten by a single character silently doubling the count. So the SMS gets the shortest true tokens that fit, and **the fallback cannot lose information** — the app carries the whole diff, so the worst case is a shorter pointer to a surface that has everything. Both render from the same stored record, making the SMS a *shortening* of the app's list and never a different claim.

The rules, in order:

- **Tokens are ordered by what the crew member acts on.** Call time first — it changes when they leave the house; a trip added mostly does not. If only one token fits, that is the one worth the characters.
- **Tokens drop whole.** `call 2:45->1:` is unreadable and `+1 tri` looks like a defect to the person holding the phone.
- **Fit against the real remainder, not a constant.** The opener, date and vessel name are already spent, and the vessel name is tenant data of unknown length. A summary sized against a fixed allowance overflows on a long boat name and splits the message — #619 with extra steps.
- **Nothing false, ever.** No call-time token when the earliest departure did not move (a cancelled *late* trip leaves it alone). No call-time token when the watermark is unknown. Trips are **netted**, because `+1 trip, -1 trip` is noise and `+0 trips` says nothing.
- **Netting has one blind spot, accepted knowingly.** A 1-for-1 swap of two *late* trips nets to zero and leaves the earliest departure alone, so both tokens vanish and the body falls back to bare `shift changed.` The manifest moved and the SMS cannot say so. This is survivable only because the fallback is a pointer to a surface carrying the full diff — so it is a standing argument for finishing the app half (#769), not a case the SMS can be made to cover within one segment.
- **`added` and `removed` read the same** (operator's call): `+1 trip` / `-1 trip`, no distinct phrasing for a day that grew versus one that shrank.
- **ASCII only**, asserted, so nothing silently flips the body to UCS-2.
- **No `check the app.` tail** (operator, 2026-08-17): the crew have had this notice for months and know where the detail lives. It cost ~15 characters of a budget measured in single digits, and those characters buy another token of what actually moved.

Result: `Muster: your Sat, Jul 4 - Barrel shift changed: call 2:45->1:15, +1 trip.`

The call time shown is the departure minus `CALL_LEAD_MINUTES`, derived at composition from the shared constant rather than stored a second time — the DEC-157 lesson, one rule with one implementation.

**Decision 4 — the app half, deferred but decided.**

Not built in this task. Settling it here so the deferral is a schedule, not an open question:

- **Two tables, following `message_reads` / `doorbell_notifications` (DEC-069, migration 0010):** one recording each change (shift, when, added/removed, start before/after) and one recording per-crew `last_seen_at`. House style — ISO text, no FKs (DEC-131).
- **Dismissal is per crew member.** Two crew on the same boat dismiss independently; "seen" is not a property of the shift.
- **Re-raise falls out of the data, not a policy.** `changed_at > last_seen_at`. A second change brings the banner back with no rule to write.
- **One banner, describing everything since you last looked** — not one per change. It is also the only version that cannot drift out of sync with the SMS.

---

**What this does not decide.** *When* a change notice fires — that is DEC-084 as amended 2026-08-17 (#765), which governs which callers emit. This decision governs only what the notice says. The two are deliberately separate: emission is about crew being told at all, content is about the telling being useful.

**Relationship:** extends DEC-084 (the notice lane and its emission rule) and #350 (which introduced the `changed` action); follows DEC-069/migration 0010 for the deferred read-state shape; applies DEC-157's one-rule-one-implementation posture to the call-time derivation; constrained by #619 (segment counting) and DEC-043 (event identity, which created the retime gap). Supersedes nothing.
