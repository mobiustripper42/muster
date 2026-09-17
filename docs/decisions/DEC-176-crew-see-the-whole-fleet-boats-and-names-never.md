---
schema: 1
id: DEC-176
title: "Crew see the whole fleet — boats and names, never a ranking"
topic: "Crew self-serve, auth & admin identity"
status: "active"
date: "2026-09-16"
ruling: "`/crew/open` shows the fleet's schedule below the claim list — boat, departure, who is aboard, which roles are unfilled. Display only: no shift state, no pax, and `Asked` is indistinguishable from untouched."
claims:
  - kind: "file"
    target: "src/crewapp/team-view.ts"
    note: "the crew-safe projection; exclusions enumerated there, not spread"
  - kind: "file"
    target: "app/(crew)/crew/open/page.tsx"
    note: "claim cards above, flat team rows below"
revisit_if: "Crew ask to act on the lower section — then it stops being display and needs its own eligibility answer"
amends_spec:
  - section: "2.7"
    scope: "the count reads \"N you can claim\" not \"N open\", and the page carries a second display-only section"
---

## DEC-176: Crew see the whole fleet — boats and names, never a ranking

The claim list renders only seats the viewer can take, so a fully-crewed fleet — the best
possible state — read as "Nothing open in this window". The operator's report (#968): *"I
checked the available shifts and it's always blank."* Crew who check three times and see
blank three times stop checking.

The exclusions are the decision. DEC-008 keeps reliability a ranking rather than a grade, and
a screen from which drip order is derivable makes it a scoreboard in a crew of a dozen — not
walkable-back once seen. So `Asked`, `Bailed`, `Open` and `Claimed` render as one
indistinguishable "unfilled". Guest counts stay out on the `other-shifts.ts` boundary, and
shift state stays on the operator's board: a crew surface labelling a boat "At Risk" has
become the dashboard DEC-042 refused.

Display only, and it must look it: claim rows are cards with a chevron, team rows are flat.
An identical row that does nothing on tap teaches crew the screen is broken.
