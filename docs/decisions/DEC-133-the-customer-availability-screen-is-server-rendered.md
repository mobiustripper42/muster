---
id: DEC-133
title: "The customer availability screen is server-rendered; the guest stepper is the one client island (12.4, #457)"
topic: "Reservations & payments"
---

## DEC-133: The customer availability screen is server-rendered; the guest stepper is the one client island (12.4, #457)

**Decision:** `/book`'s "Date & time" screen holds the zero-client-JS default (server-rendering-default). Date and time are picked by `AppLink` server navigation — each pick is a `force-dynamic` round-trip that re-derives availability and re-renders, exactly like the admin calendar. **One deliberate exception:** the guest stepper is a client island (`app/(public)/book/book-controls.tsx`) so the running total moves live on ±, the way the approved mockup draws it. That's the worthwhile-UX-win test the DEC-021-era no-JS discipline reserves the escape hatch for: a whole-boat party fare recomputing per tap is a real, visible win, and a full server round-trip per stepper tap on mill-dev/Neon is exactly the perceived-latency trap the press-feedback layer (#202/#250) exists to avoid.

**Boundary:** the island is a small React context provider feeding a `GuestCard` and a sticky `Footer`; the server-rendered hero / calendar / slot rows pass through as `children`, so **no function ever crosses the RSC boundary** (the server→client function-prop serialization trap — only render/e2e catches it, not `next build`). The footer's Continue link composes the URL-selected slot (server-priced base) with the client guest count and hands both to `/book/checkout` (12.5). Fare math is `composeFare` (12.2) mirrored in the island, so screen and checkout price identically.

**Accepted wrinkle:** guest count is client state, NOT in the URL, so it resets to the default when the date or time changes (those are server navs that re-render from scratch). The natural order is date → time → guests → continue, so it rarely bites; revisit (carry `guests` in the URL, or make slot links client-aware) only if it does. **Refines:** DEC-021/042 (palette + no-JS posture), the server-rendering-default working rule. Companion: DEC-125 (whole-boat availability the screen reads), DEC-132 (the customer it books for).
