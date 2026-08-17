---
id: DEC-148
title: "Crew navigation moves into a drawer — the hub carries work, not a menu (#644)"
topic: "UI, brand & frontend patterns"
amends_spec:
  - section: "2.6"
    scope: "the hub renders no navigation entries — they moved into the drawer; \"Pick up a shift\" is the single exception and stays on the hub"
---

## DEC-148: Crew navigation moves into a drawer — the hub carries work, not a menu (#644)

**See also** — decisions this one changed part of:
- Reverses DEC-091 — the "no persistent crew nav" holding and the rejection of an admin-style nav — crew navigation is now a persistent drawer on every route; the hub-and-spoke reasoning that justified the ban is what stopped holding
- Corrects DEC-093 — where the switch-to-admin control lives — the drawer on every crew route, no longer the crew home beside Sign out

**Status:** Decided 2026-08-05 (Eric). Recorded 2026-08-06.

**Decision.** Crew navigation lives in a drawer behind a hamburger, on a shared header present on
every crew route. The `/crew` hub carries work — the ask, My shifts, standing, the credential nudge
— and no navigation. **"Pick up a shift" is the one exception and stays on the hub:** DEC-074 calls
it "an invitation, not a demand", and filing an offer of work under a menu changes what it is.

**Why DEC-091's ban stopped holding.** Its argument was that the hub already puts every destination
one tap away, so persistent chrome adds nothing. True at three entry points; the hub reached five
cards plus a three-link footer one DEC at a time, and none of them amended the count. Measured at
375px, "My shifts" started 637px down an 812px screen — 78% of the first view was menu. It is 411px
now. The principle was sound; the premise expired.

**What survives from DEC-091.** The unread-badge ban: nothing floats on the closed hamburger, and
re-enabling messaging does **not** grant a closed-drawer indicator — that is the open question to
settle first. And crew still has no inline link row and no grouping; what ported from `admin-nav.tsx`
is the panel, not the shape. Crew's is a `<details>` that works with no JS, a stricter bar than
admin's, because admin falls back to inline links at desktop width and crew has none (DEC-147 rule 2).
