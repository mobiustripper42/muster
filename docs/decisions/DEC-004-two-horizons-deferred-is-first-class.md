---
id: DEC-004
title: "Two horizons; `deferred` is first-class"
topic: "Timing — horizons, deadlines & vessel clock"
---

## DEC-004: Two horizons; `deferred` is first-class

**Decision:** Each rule has a horizon. **Booking horizon** rules (property: vessel, COI, pax, season)
gate the sale far out. **Staffing horizon** rules (crew) vote N days before the trip when humans get
committed. A rule outside its horizon **abstains** (`deferred`), making a booking *provisional* and
feeding the admin worklist. The full crew solve runs **only inside the staffing horizon**; outside
it the crew group does at most a cheap "could this ever plausibly be crewed" check. **Model the
staffing horizon as a list-of-one, not a scalar** (room for staged checkpoints — DEC-TBD / Pass D).
**Why:** Crew availability isn't knowable months out; forcing it to vote early produces noise
(SPEC §1.3).
**Tradeoff:** Bookings carry a provisional state and a `recheckBy` date.
**Revisit if:** Progressive commitment (Pass D) generalizes the single horizon to ordered checkpoints.
