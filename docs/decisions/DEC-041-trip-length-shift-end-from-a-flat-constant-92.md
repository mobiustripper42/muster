---
id: DEC-041
title: "Trip length → shift end, from a flat constant (#92)"
topic: "Seats, shifts & state machine"
---

## DEC-041: Trip length → shift end, from a flat constant (#92)

**See also** — decisions this one changed part of:
- Retires DEC-021 — the `Event.durationMinutes` line only

**Status:** Built (task 92). Surfaced while adding trip times to the outbox/crew cards: an `Event` carries only a departure `time` (no length, no end), so neither the operator-as-crew In/Out decision nor the crew card could show "how long am I committed." This adds the **end** of the window; the start (call time = first departure − `CALL_LEAD_MINUTES`) already existed.

**Source of truth — (c) flat constant, deliberately:**
- `TRIP_DURATION_MINUTES = 100` in `builder/derive.ts`, sibling to `CALL_LEAD_MINUTES`. Every trip is assumed this long.
- (a) **Xola product duration** was rejected for now: the live wire shape (`XolaOrderItem`) carries only `arrival*` (the start) — no length field — and it's unverified the API exposes a product duration at all. Nothing to map.
- (b) **Operator-configured** per-product/vessel length is the right long-term home but a settings surface — out of scope for a display unblock.

**No migration / no `Event.durationMinutes` column — yet.** The issue floated landing the field now as forward-provisioning. Rejected on YAGNI: with a flat constant the column would store no information, and the migration is additive and cheap to add *whenever* a real per-event source (a/b) lands. So the column is a **deliberate omission**, not an oversight — add it together with its source, not before.

**Shift-end formula:** `shiftEnd = latestScheduledStart + TRIP_DURATION_MINUTES + TEARDOWN_MINUTES`. With a flat length the latest *departure* yields the latest *end*; when per-event durations land this generalizes to `max(start + duration)`.

> **Amendment (#275, 2026-07-11):** the end buffer is no longer the call lead reused symmetrically. It was — report 45m before the first departure, off 45m after the last trip — but that ran the "back" time long (a 4pm last trip read as "back ~6pm"). Split out a distinct **`TEARDOWN_MINUTES = 25`** (securing the boat is shorter than getting ready to sail) and use it for the tail; the front call time still uses `CALL_LEAD_MINUTES = 45`. Applied everywhere the post-trip buffer appears: `shiftEndFromEvents`, `committedWindow`/`committedMinutes` (payroll), and the split-suggestion gap/span math (`occupiedMin = TRIP_DURATION + TEARDOWN + CALL_LEAD`, the same buffer between consecutive trips). Both remain flat, fleet-wide, plain constants until a per-vessel resolver lands.

**Where the math lives (DEC-020):** `CALL_LEAD_MINUTES` moved from `crewapp/shift-card.ts` down to `builder/derive.ts` (re-exported from the card for back-compat), joining the other scheduling leads — because the shift *end* is cross-cutting: the crew card, the crew-app ask card, **and** the outbox all need it, and the outbox reads it as an instant. `derive.ts` gains `latestScheduledStart` + `shiftEndFromEvents` (instant-returning, DST-correct per DEC-032). The two clock-string surfaces (crew card, ask card) compute the end with the shared `plusMinutes` + the same constants, so no surface can disagree on the window — the same naive-clock vs instant split `callTime`/`tripStart` already live with.

**Display:** outbox card facts line → start–end window; crew shift card → a "Shift End" tile beside Start/First-departure; crew-app ask card → departure becomes a start–end range. Customer-facing trip duration is portal-era — the *data* (the derivation) lands now, no customer surface.

**Relationship:** extends DEC-021 (call lead) and DEC-032 (vessel-local); reuses DEC-031's "derived, never stored" discipline; adds no new domain state or schema. Supersedes the `Event.durationMinutes` line of #92 with a documented deferral.
