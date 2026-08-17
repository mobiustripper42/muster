---
id: DEC-032
title: "Vessel-local time — wall-clock storage + one tenant timezone, NOT stored instants"
topic: "Timing — horizons, deadlines & vessel clock"
---

## DEC-032: Vessel-local time — wall-clock storage + one tenant timezone, NOT stored instants

**See also** — decisions this one changed part of:
- Revises DEC-022

**Status:** DECIDED — Phase 5 / 5.3 (#77), 2026-06-12. (@architect design + operator confirm.)

**Decision:** Times stay stored as **vessel-local wall-clock** (`Event.date`/`Event.time` already are — the vessel-day shift grouping depends on it) and are interpreted + rendered in the **vessel's** timezone — **never the viewer's** (confirmed: crew on the dock and the operator on the phone, even from another zone, both read the same boat-time). One tenant IANA tz in **`src/config/tenant.ts`**: `TENANT_TIMEZONE = process.env.TENANT_TZ ?? "America/New_York"` — **env-overridable** per deploy; code-constant/tenant-config-later (DEC-001 posture, like `STAFFING_HORIZON_LEAD_DAYS`). BrewBoat is **Eastern** — the fleet runs out of **Cleveland** (East Bank of the Flats at Canal Basin Park, on the Cuyahoga); the Seattle seed dock was placeholder. The mechanics:

1. **One mint seam.** `zonedWallClockToInstant(date, time, tz)` (`Intl`-based, DST-correct, **no new dependency**) replaces the `eventStart` UTC parse in `src/builder/derive.ts`. Every departure instant is born true, so all downstream math vs a real `now` (hoursToTrip, fills-by, horizon birth, bail lateness, "departed") self-corrects. `tz` threads as an optional param (default `TENANT_TIMEZONE`) through `earliestScheduledStart`/`scheduledStarts`/`staffingHorizon*`/`fillDeadline*` and the read-model entry points (`deriveAtRiskBoard`/`deriveWarming`/`buildOutboxView`/`buildAssignmentView`/`buildCrewAppView`/`tick`/`bailWithDerivedLateness`) — exactly like `leadDays`. Prod gets Eastern by default; the engine tests pin `tz: "UTC"` to keep fixtures deterministic.
2. **Render in vessel tz.** Formatters of an event-derived instant (`app/lib/format.ts` `fmtDeadline`, the board `fmtTime`, the cockpit horizon line) format with `TENANT_TIMEZONE` so the true instant displays the dock wall-clock. Raw `event.time`/`callTime`/`departureTime` strings shown verbatim are **unchanged** — already vessel-local.
3. **Credential date boundary** (`mmcValidOnDate`): a pure **date-only ISO-string comparison** (`expiry >= tripDate`) — `YYYY-MM-DD` sorts lexically = chronologically, so it is **timezone-invariant by construction**, no `new Date`, no day-shift. (Chosen over a `startOfDayInstant` conversion — simpler and unambiguous.)
4. **Crew "today"** (`crew-view`): the past-shift filter uses `vesselDateOf(now, tz)` (the vessel-local calendar date), not `now.toISOString()` (UTC, a day ahead in the evening Eastern hours).

**Rejected:** "store true instants" — breaks the vessel-day grouping model and forces a DDL migration; the one-seam conversion achieves correctness without it. **Viewer-local rendering** — rejected; vessel-local for everyone is simpler and matches the dock. **Why it matters:** DEC-022's "render everything UTC" v1 simplification showed an Eastern 6:50 AM departure as a wrong wall-clock — on the exact surface (the shift card) whose job is call-vs-departure clarity. **Revises DEC-022.** Gate for real Xola data (5.4). No DDL, no port change, no new dependency.
