---
id: DEC-148
title: "Crew navigation moves into a drawer — the hub carries work, not a menu (#644)"
topic: "UI, brand & frontend patterns"
amends:
  - id: DEC-091
    relation: reverses
    scope: "the \"no persistent crew nav\" holding and the rejection of an admin-style nav — crew navigation is now a persistent drawer on every route; the hub-and-spoke reasoning that justified the ban is what stopped holding"
  - id: DEC-093
    relation: corrects
    scope: "where the switch-to-admin control lives — the drawer on every crew route, no longer the crew home beside Sign out"
amends_spec:
  - section: "2.6"
    scope: "the hub renders no navigation entries — they moved into the drawer; \"Pick up a shift\" is the single exception and stays on the hub"
---

## DEC-148: Crew navigation moves into a drawer — the hub carries work, not a menu (#644)

**Status:** Decided 2026-08-05 (Eric). Recorded 2026-08-06.

**Decision.** Crew navigation lives in a drawer behind a hamburger on a shared header, present on
every crew route. The `/crew` hub carries **work** — the open ask, My shifts, own standing, the
credential nudge — and no navigation entries. Drill-in surfaces use the same one-row header (back
left, title centred, menu right) instead of the stacked `BackLink` + heading.

**The single exception is "Pick up a shift", which stays on the hub** (operator's call). DEC-074
calls it "an invitation, not a demand": it offers *work* rather than a route to a utility, and
filing an offer under a menu changes what it is.

**Why the hub-and-spoke argument stopped holding.** DEC-091's reasoning was that crew's home *is*
the hub — "every destination one tap away" — so persistent chrome "adds nothing but the app-frame
the 'insultingly small' ethos resists." That was true when the hub had three entry points. It
reached **five** cards plus a three-link footer, one DEC at a time (DEC-074, DEC-091, DEC-098,
DEC-009, §7.6), and none of them amended the count. Measured on the seeded crew home at 375px:
**"My shifts" began 637px down an 812px screen — 78% of the first phone view was menu**, and the
list a crew member opened the app to read started below the fold. It is 411px now.

So the ban did not fail on its principle; it failed on its premise. "One tap away" had become "one
tap away, after a screen and a half of scrolling." The operator put it plainly (2026-08-05): *"the
crew page with menu buttons really it's bad."*

**It is a MOVE, not an addition.** The cards are gone from the hub, so there is exactly one path to
each route — not the "second way to reach the same seven routes" that #644 warned about. That
distinction is what keeps the "insultingly small" stance intact: the app did not gain a surface, it
relocated its chrome off the one screen that is supposed to be about work.

**The drawer borrows admin-nav's mechanism, not its shape.** DEC-091 rejected "an admin-style top
nav" and said `admin-nav.tsx` "does not port." Half of that still stands: crew has no inline link
row, no grouping, and seven flat destinations rather than admin's twelve-peer hierarchy. What did
port is the slide-in panel and its dismissal behaviour. Crew's drawer is a `<details>`, so it opens
and closes with **no JavaScript** — a stricter bar than admin's, and a necessary one: admin renders
its links inline at desktop width as a fallback, and crew has none, so a JS-only drawer would strand
a crew member with no navigation at all (DEC-147 rule 2).

**The unread-badge ban survives.** DEC-091's objection to "a persistent, always-on unread badge" as
an ambient-pull anxiety vector (BRAND "push, not pull", DEC-042, DEC-071) is **not** reversed. The
Messages entry sits in the drawer with its count visible only when the drawer is opened; nothing
floats on the closed hamburger. Messaging is flag-dark pending a native app (operator, 2026-08-05),
and **if it is re-enabled, whether a closed-drawer indicator is permissible is the open question to
settle first** — this decision does not grant it.

**How this was recorded late, which is the part worth remembering.** The work shipped in
[#665](https://github.com/mobiustripper42/muster/pull/665) without anyone reading DEC-091. It was
`@architect`-gated and it rejected, by name, the thing that was built. The contradiction was caught
by a `@code-review` pass run **after merge**, only because the operator noticed `/kill-this` — and
therefore the review step wired into it — had been skipped for the whole session. A decision that
contradicts shipped code is a decision that quietly stops being read; this file exists so DEC-091's
banner sends the next reader here instead of to a rule the app no longer follows.
