---
schema: 1
id: DEC-161
title: "Occupancy is measured in hold minutes, not trip time"
topic: "Reservations & payments"
status: "active"
date: "2026-08-29"
ruling: "A boat is busy for its hold minutes — trip plus turnaround — not just the time the customer is on the water."
claims:
  - kind: "spec"
    target: "2.8.3"
  - kind: "file"
    target: "src/domain/entities.ts"
    note: "Offering.holdMinutes, read nowhere in occupancy math"
revisit_if: "turnaround has to vary by departure rather than be one figure for the offering"
amends_spec:
  - section: "2.8"
    scope: "2.8.3 measures in hold minutes; 2.8.4a freezes both durations; 2.8.1 stores a reserved time and derives expiry"
  - section: "2.10"
    scope: "2.10.2's frozen booking carries both durations"
---

## DEC-161: Occupancy is measured in hold minutes, not trip time

See also DEC-041 — the crew-side trip length, deliberately a separate constant.

### Context

`Offering` carries two durations. One is minutes on the water; the other is the boat's whole
commitment, turnaround included. The second round-trips through the admin form and is read by no
occupancy decision. Every one of those measures with the first, and §2.8 specified the same mistake.

### Decision

Occupancy is hold minutes. BrewBoat's are 120 against a 100-minute trip, so measuring with the
trip frees the hull twenty minutes early and a rival at 15:15 sells against an unfinished 13:30.

Both durations freeze onto the reservation. Turnaround is the difference between them and is not
stored, because a third number is a third thing that can disagree.

Reserved time is stored; expiry is derived from it plus the payment window, which is a setting. An
expiry column was rejected — it carries nothing the reserved time does not, and two stored numbers
can diverge. Changing the setting moves deadlines already in flight, accepted because the value
lives in the host's env and the window is minutes long.
