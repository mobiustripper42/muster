---
id: DEC-147
title: "Every outbound message names its audience first"
topic: "Outbound notifications & operator relay"
amends_spec:
  - section: "2.5"
    scope: "the operator At-Risk alert opens `Muster ADMIN:` rather than `⚠ Muster:`, so it is distinguishable from a crew ask in a truncated preview"
---

## DEC-147: Every outbound message names its audience first

**Decision:** Every outbound body is composed through one helper (`outbound(audience, body)`)
that puts an audience marker at the **front**. Two audiences: `crew` (`Muster:`) and `admin`
(`Muster ADMIN:`). All four outbound classes route through it — the crew ask, the assignment
notice (DEC-084), the doorbell ring (DEC-073), and the operator At-Risk alert (DEC-095). The
alert's leading `⚠` is dropped.

**Why:** DEC-092 makes every admin also crew, so the operator is the only human who receives
**both** classes on the same phone from the same sender, and must decide which hat applies
before acting. A crew ask is a personal commitment ("will you work this?"); a board alert is an
operational escalation ("nobody will work this — go do something"). Reading one as the other
means either a shift you thought you'd taken, or a shift you thought someone else was handling.
On 2026-07-29 a captain bailed on `Brew 4`; the operator received the board alert at 13:00:26
and read it as an ask. The only real ask that tick went to someone else.

**The messages were already different — the difference was in the wrong place.** "In or out?"
versus "needs you" sat at the *end* of the first line, behind a date and a vessel name. A
lock-screen preview truncates from the **right**, so those words are invisible exactly when
enough messages are stacked up to need them. What survived truncation differed by a single
leading character: `⚠ Muster:` against `Muster:`. Front-loading is the whole fix; a glyph is
not a word, and the eye does not parse it as one.

**A shared helper, not a fix at the one call site that broke.** Four senders each composed
their own opener, so "make this one clearer" would have been re-litigated per message type the
next time. That is the shape this project keeps getting bitten by — the `/admin` hub's two
hand-edited menus, the auth sweep's duplicated kill-switch, #600's three fill doors. One map,
four consumers. Adding a fifth outbound class now requires choosing an audience, which is a
question the author has to answer rather than a default they can drift past.

**The `⚠` goes.** It was carrying the entire distinction and failing, it costs a UCS-2 segment
against a GSM-7 body (the same reason `forward-notices` avoids `·`), and the word ADMIN does the
job unambiguously.

**Wording is the operator's, shape is not.** Changing `Muster ADMIN:` to something else is a
one-line edit in `OPENER`. What must hold is the shape: marker first, and the two audiences
differing by a **word** rather than by punctuation or a glyph.

**Tradeoff:** the ring notification's body changed (`You have a new Muster message` →
`Muster: you have a new message`), so three test files that asserted the literal were rewritten
to assert `RING_NOTIFICATION_BODY` plus #387's actual invariant — no count, no note content.
Asserting the constant rather than the copy is the better test anyway; the previous form would
have reddened on any wording change regardless of whether the rule still held. **Rejected:**
changing only the board alert (leaves the convention unstated and the next sender free to
invent its own); a per-message-type prefix like `Muster ASK:` / `Muster ALERT:` (the reader's
question is *which hat am I wearing*, not *which subsystem sent this* — two audiences, not five
categories); putting the marker at the end where the distinguishing words already were.
**Revisit if:** a third audience appears (a customer-facing outbound would need one, and
`Audience` is the place it goes). **Phase:** 12.
