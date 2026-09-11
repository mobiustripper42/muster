---
schema: 1
id: DEC-168
title: "The booking charge is a raw PaymentIntent, not a Checkout Session"
topic: "Reservations & payments"
status: "active"
date: "2026-09-10"
ruling: "Embedded Checkout cannot mount before its session exists, and /book mounts the card field before it claims anything — so the booking charge stays a raw PaymentIntent."
claims:
  - kind: "file"
    target: "app/(public)/book/checkout/checkout-form.tsx"
    note: "validates the Element, then claims the hull, then mints the intent"
  - kind: "file"
    target: "src/adapters/stripe-payment.ts"
    note: "the only module that talks to Stripe; holds the intent and both hosted sessions"
  - kind: "spec"
    target: "2.8.4a"
revisit_if: "Stripe ships a deferred mount for elements-mode Checkout Sessions — a Payment Element that renders before a session object exists"
---

## DEC-168: The booking charge is a raw PaymentIntent, not a Checkout Session

### Context

DEC-134 chose this and was retired; §2.8.4a and §2.8.4b, the spec text that replaced it, name
neither Elements nor Checkout nor PaymentIntents. Retirement deleted the reason — and Stripe now
leads the other way: *"Don't use the Payment Intent API unless the user explicitly asks."*

### Decision

The ordering is the reason. `/book` mounts the Payment Element with no server object; on submit
it validates the card, claims the hull, then mints the intent. Stripe documents that shape as its
own integration — *Collect payment details before creating an Intent* — and still lists Elements
over PaymentIntents as a supported row, *ADVANCED INTEGRATION*.

*Rejected: embedded Checkout.* Its form takes the client secret the server returns, so the session
must exist before a card field renders. That buys either a boat claimed when someone merely opens
the page, or a payable session outliving every visit that wanders off. It also wants a customer
email, where our identity is the phone — a cost the hosted sessions pay after the sale.
