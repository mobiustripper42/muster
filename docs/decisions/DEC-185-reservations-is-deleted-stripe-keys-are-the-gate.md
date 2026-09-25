---
schema: 1
id: DEC-185
title: "RESERVATIONS is deleted — Stripe keys are the gate"
topic: "Reservations & payments"
status: "active"
date: "2026-09-24"
ruling: "The RESERVATIONS flag and its guards are gone. The booking flow is on in every deployment; one without Stripe keys cannot take a booking, because checkout refuses before any row or charge."
claims:
  - kind: "file"
    target: "app/lib/flags.ts"
    note: "reservationsEnabled removed; MESSAGING and TIME_CLOCK stay"
  - kind: "file"
    target: "app/(public)/book/checkout/actions.ts"
    note: "the Stripe-keys check is now the first gate"
  - kind: "file"
    target: "src/reservations/booking-webhook.ts"
    note: "the webhook's flag gate and its reservations_off trail shape are gone"
revisit_if: "A deployment needs Stripe keys set while booking stays off, such as a live payments test before launch"
---

## DEC-185: RESERVATIONS is deleted — Stripe keys are the gate

The flag kept `/book`, checkout, the manage pages and the webhook's new-booking path dark. The
decision it cited, DEC-111, was already retired (issue #816), so nothing active stood behind it.

Operator, 2026-09-24: *"I can't really envision a future in which there is crewing without
reservations."* A switch that turns the reservation half off serves no configuration anyone will
ship. Production had it unset and has no Stripe keys either, and the keys are what actually
matter: without them checkout refuses and no signed webhook arrives.

*Accepted:* `/book` is visible in production to anyone with the URL, and the booking links show
in the admin nav. Same shape as DEC-175, which deleted `CREW_SELF_SERVE`.
