---
id: DEC-152
title: "Two clock buttons that never move, one disabled — a control that vanishes moves its neighbour under the thumb"
topic: "Timing — horizons, deadlines & vessel clock"
amends_spec:
  - section: "2.9"
    scope: "§2.9.7's `/crew/time` bullet only — its \"one card, one button … never both\" rule. Everything else in the Time Clock section stands: the one-open-punch rule (§2.9.4), the forgotten clock-out (§2.9.5, relocated on screen but unchanged), the three surfaces, the render-time \"On the clock since\" line, the per-punch editor and the running total. Anchored at §2.9 because §2.9.7 is a bold paragraph rather than a numbered heading, and the checker only resolves headings"
---

## DEC-152: Two clock buttons that never move, one disabled — a control that vanishes moves its neighbour under the thumb

**Status:** Accepted (operator, 2026-08-09). Issue #718, reported from production on the time clock's first live day.

**Decision:** `/crew/time` renders **both** clock buttons at all times, in a fixed order and a fixed position, with the inapplicable one **disabled**. Nothing above a button may change height.

This reverses SPEC §2.9.7's `/crew/time` rule — *"one card, one button. Clock in when they're out, Clock out when they're in; never both, never a guess about which they meant."*

### What the spec was protecting, and what it cost

The rule is not silly. One button cannot be mistaken for the other, and the surface never asks the crew member which they meant. That is a real property and it is why it was written.

It bought that property by **moving the control**, and that turned out to be the worse failure.

### Measured, because reading the code got it wrong twice

On the clock's first live day, a crew member clocked out and immediately clocked back in. Driving the real surface at 375px:

```
Clock out   y 239 – 291
Clock in    y 193 – 245     ← after the press
overlap     6px
```

Clocking out **shrinks** the card: the "On the clock since HH:MM" line disappears and the banner text changes from *"You're on the clock."* to *"Clocked out — your hours are below."* The button below slides **up** 46px, and its new box overlaps the region the thumb just pressed. A second tap — without moving your hand — does the opposite of what you just did.

It is directional, and the dangerous direction is the one that happened: clocking *in* pushes the next button **down** 78px with no overlap.

**Two wrong diagnoses preceded the measurement**, and both came from reading code instead of the rendered page. First: that the buttons shared coordinates — they never did. Second: that a pre-hydration tap ate the first press — impossible, since a server-action `<form>` posts natively without JS, which only powers the disabled-while-sending state. Only bounding boxes settled it, so bounding boxes are what the test asserts.

### Why disabled beats absent

A disabled twin cannot be mis-tapped. A moving button can. The unambiguity §2.9.7 wanted survives — the two actions are never the same tap target — and the movement that caused the defect goes away.

The same reasoning retired the mid-edit behaviour: the clock buttons used to be **removed** while a punch editor was open. They are now disabled instead. A control that vanishes is a control whose neighbour slides into its place, which is this defect one state over.

### Green means live, not "Clock in"

The enabled control is green; the disabled one is inert grey. So the green **moves between the two
buttons** as the state changes rather than belonging to either — it says *this is the live action*,
not *this is clocking in*. Mid-edit both are grey, which reads correctly: nothing is live.

Computed from the enabled/disabled flag rather than from which button it is, so the two cannot
drift apart in a later edit.

They are also **separated and rounded** rather than flush. The single full-bleed green button is
the right shape on the ask in/out surface, where there genuinely is one action; here there are two
and only one is live, which is a different thing to say (operator, 2026-08-09).

### The rule that falls out

**Nothing above a clock button may vary in height.** In practice:

- the status line renders in both states — *"On the clock since 9:04 AM"* or *"Not on the clock"* — so it cannot collapse;
- the forgotten-clock-out warning (§2.9.5) moved **below** the buttons, since it is conditional;
- the success and error notices moved below the card, for the same reason — they appear, disappear and change length on every punch.

Where the notices finally sit is **deferred, not settled** (operator: *"I don't care right now. I can't decide that until I see how it works."*). That they cannot sit above the buttons is settled.

**Asserted by measurement, not by eye.** `e2e/crew-time.spec.ts` → *"#718: neither clock button moves across a punch"* reads both bounding boxes at rest, after clocking in, and after clocking out, and requires all three to be identical. A visual review would have passed the original layout too — 46px looks fine on a screenshot and is a thumb's width in the hand.

### Shipped to be observed, with two changes deliberately not made

*"We're going to go with this design and see how it goes"* (operator, 2026-08-09). Two candidates
were raised and held back rather than rejected:

- **Bigger buttons, further apart.** Both already clear the 44px target; more separation is cheap
  and would widen the margin further. Worth doing if a mis-tap is reported again.
- **One green, one red** — and the operator named the objection in the same breath: *"which would
  only look the same color to color blind people."* Red/green is the single worst pair for
  deuteranopia and protanopia, and it would make the live/inert distinction **invisible** to a
  chunk of crew while looking more legible to everyone else. Green-vs-grey survives greyscale as a
  lightness difference. Do not "improve" this to red/green.

**Touches** SPEC §2.9.4 (at most one open punch — unchanged, and it is why the *domain* never double-punched even when the UI invited it), §2.9.5 (the forgotten clock-out, relocated not changed), and #718.
