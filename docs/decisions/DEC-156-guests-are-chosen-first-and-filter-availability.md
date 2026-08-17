---
id: DEC-156
title: "Party size is chosen first, lives in the URL, and filters availability to boats that fit (#715)"
topic: "Reservations & payments"
amends:
  - id: DEC-133
    relation: revises
    scope: "the accepted wrinkle only — guest count now lives in the URL, and the order is guests → date → time. The server-rendering-default posture and the single-island boundary stand."
---

## DEC-156: Party size is chosen first, lives in the URL, and filters availability to boats that fit (#715)

**Decision:** on `/book`, the guest count is chosen **before** the date, is carried in the URL alongside `offering`/`date`/`time`, and **filters** the calendar and the departure list to boats that can take the party. A day whose boats are all free but all too small renders in its own state — not "sold out", not "nothing runs".

**Why the order flipped.** Party size is the first thing that determines what a customer can buy and it was the last thing we asked. The hero advertised `up to N guests` from `offeringCapacity` — a `Math.max` across every hull on the offering — so a party of 20 was told "up to 24", browsed a month of dates where only a 12-pax boat was free, picked one, and discovered at checkout that the number didn't work. Every day on that calendar looked bookable. The operator's standard, recorded on issue #715: **never show a customer something they cannot buy.**

**The fit is not new math.** `candidateVessels` (`src/reservations/claim.ts`) has always filtered an offering's vessels to those that exist, fit the guest count, aren't blocked and aren't hull-busy — at *hold* time, at the very end of the funnel. This runs the same fit at *browse* time, by filtering the `VirtualSlot[]` the deriver already produces. Because those slots are already hold-aware (#620), browse-time fit inherits that for free rather than re-plumbing it.

**Sold-out and too-big stay distinct.** Collapsing them tells a party of 15 "sold out" about a week of empty boats, and they leave thinking they were unlucky rather than knowing to bring fewer people or call. `dayState` returns `toobig` only when **no** boat that day fits; a fitting boat that is taken is still `soldout`. Issue #752 carries the open question of how that state is *presented* — the distinction itself is settled here.

**The hull you are quoted is the hull you get.** `SlotRow` carries both `capacity` (the departure's ceiling) and `boatCapacity` (the smallest fitting boat — the one `candidateVessels` claims, DEC-109). Customer-facing copy reads `boatCapacity`: on a 12/14/16 departure a party of 12 is going on the 12, and "16 guests included" describes a boat the claim would hand to somebody else.

### What this revises in DEC-133, and what it does not

DEC-133 accepted a wrinkle and named its own trigger:

> guest count is client state, NOT in the URL, so it resets to the default when the date or time changes… revisit (carry `guests` in the URL, or make slot links client-aware) only if it does.

It bit. Once the count filters what the server renders, the server must have it, so the first of those two options is taken and the wrinkle is gone.

**DEC-133's substance stands.** The screen is still server-rendered by default; the guest stepper is still the one client island; no function crosses the RSC boundary. What changed is where the count *lives*, not who renders the page.

**The island survives, and the URL sync is unconditional.** The stepper keeps local state so the number and the price move under the thumb, with a debounced `router.replace` settling the URL — one round trip per interaction rather than per tap, which is the perceived-latency trap DEC-133 invoked the escape hatch for in the first place.

It is tempting to skip that navigation when it changes nothing. It usually doesn't: the set of fitting boats is decided by the smallest hull that takes the party, so on a 12/14/16 offering only two steps in the whole 1→16 range alter what is bookable. **Skipping is still wrong.** Every day cell, slot row and month pager is a server-rendered link with `guests` baked into its href, so an un-navigated change leaves those links one count behind and the next date pick silently restores the old number — DEC-133's wrinkle, reintroduced in miniature. The links and the count have to move together.

**Bounds.** The stepper's floor is 1 and its ceiling is the offering's largest hull, both read off that offering's vessels; the landing value is its *smallest* hull, so the customer opens on the fullest calendar the offering can show and days only drop out as they step past a boat. There is deliberately nothing past the ceiling — a party that doesn't fit the largest boat is not a booking this system takes (operator, 2026-08-16).

**Companion:** DEC-125 (whole-boat availability), DEC-109 (smallest-that-fits claim order), DEC-124 (extra-guest fare).
