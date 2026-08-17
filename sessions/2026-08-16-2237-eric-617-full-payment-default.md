---
session: 85
dev: eric
slug: 617-full-payment-default
branch: task/617-full-payment-default
started: 2026-08-16T22:37:20Z
ended:
points:
pr_numbers: [753]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/fb57b653-9788-4c53-98be-5708d92c7a9a.jsonl
---

# Session 85 — 617-full-payment-default

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: Guest count comes first and filters availability to boats that fit (issue #715)

**Completed:**
- `src/reservations/availability-screen.ts` + test — `dayState` gains a `toobig` state (a day whose
  boats are all free but all too small is NOT "sold out"); `SlotRow` gains `fits` and
  `boatCapacity`; new `offeringCapacities` / `offeringMinCapacity`; `bookHref` moved out of the
  page so the URL carry is provable rather than eyeballed across what turned out to be 7 call sites.
- `app/(public)/book/page.tsx` — guests resolved from the URL and clamped, guest card above the
  calendar, fit-aware calendar + slot rows, hero ceiling narrows to the selected day.
- `book-controls.tsx` — island keeps local state, debounced `router.replace` settles the URL.
- `checkout/page.tsx` — `backHref` delegates to `bookHref`; fare reads `boatCapacity`.
- Seed: one 12-pax hull → Brew 3/1/2 at 12/14/16 with 10 bookings, per-hull reservation ids,
  event capacity following the boat, `tripLengthMinutes: 100`, `includedGuestCount: 10`.
- 5 e2e specs updated to the three-hull fixture + new `plantVesselBlock`; DEC-156 written.

**Re-estimated 5 → 8** at spec time. The issue costed the filter and the URL carry; it didn't cost
the new day state, the per-day headline, the island decision, or the seed.

**Three things worth remembering:**
- **The operator's own insight killed my design.** Changing the count only changes what's bookable
  when it crosses a boat's capacity — two crossings on a 12/14/16 offering — so I built a tier
  short-circuit to skip the navigation. It cannot work: every day cell and slot row is a
  server-rendered link with `guests` in its href, so an un-navigated change leaves those links one
  count behind and the next date pick silently restores the old number. Deleted `tierOf`/`sameTier`
  rather than ship dead code. Debounce gets the same win honestly.
- **Widening the seed had a blast radius I did not predict.** 13 failures across three specs I
  hadn't touched, plus it made issue #702's symptom (stacked open cards on one hull) visible in the
  demo world for the first time. `seed-xola.ts` documents a day-allocation contract with this
  fixture — demo books offsets +2/+3/+6, Xola takes the four free days — which is why the new
  bookings all land on those three days.
- **Two rotten assertions found.** The footer total was checked with `getByText("$499.00").first()`,
  which matched a slot row and would have passed forever testing nothing. And `calendar.spec`'s
  `Open 1` was a literal that was right only by coincidence of a one-boat fixture.

**Code review:** @code-review — 3 findings, all fixed. The sharp one: DEC-133 recorded this exact
behaviour as an *accepted wrinkle* and named "carry `guests` in the URL" as the trigger to revisit;
the diff did that and shipped without amending it. DEC-156 now amends it, scoped. Also: Continue
wasn't gated on the debounce, so a fast tap sent checkout a slot chosen for a different party size.
/security-review — 0 findings; the crafted-`?guests=` underpayment path terminates because the
charge recomputes from the held vessel. `/code-review ultra` not run.

**Also filed:** issue #752 — the too-big day is a dead cell whose only explanation is a colour key.

**PR:** [PR #753](https://github.com/mobiustripper42/muster/pull/753)
**Points:** 8
**Branch:** task/715-guests-before-dates
**Opened at:** 2026-08-17T02:31:00Z

**Next Steps:**

**Context:**
