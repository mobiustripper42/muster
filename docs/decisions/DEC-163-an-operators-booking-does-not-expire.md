---
schema: 1
id: DEC-163
title: "An operator's booking does not expire"
topic: "Reservations & payments"
status: "active"
date: "2026-08-29"
ruling: "A booking the operator took by phone holds its boat until a person cancels it. Nothing frees it on a timer."
claims:
  - kind: "spec"
    target: "2.10.6"
  - kind: "unverifiable"
    target: "Source is only 'xola' | 'muster' at src/domain/entities.ts:566; no admin value exists yet"
revisit_if: "the operator is chasing unpaid phone bookings daily rather than occasionally"
amends_spec:
  - section: "2.8"
    scope: "2.8.7 and 2.8.8 exempt a `pending` row whose source is `admin` — no window, never swept"
  - section: "2.10"
    scope: "2.10.6 gives an operator's booking no expiry, and marks it with `admin` as its reservation source"
---

## DEC-163: An operator's booking does not expire

### Context

A public checkout holds its boat for the payment window and then lets go (§2.8.8). A phone booking
is paid by a link the customer opens later — after dinner, tomorrow — so that window would expire
before most people look. DEC-162 is what puts it on a link.

### Decision

The row never lapses. The operator tells the customer to pay by tomorrow, watches the purchases
list, and either cancels it or gives them longer.

*Rejected: a longer window.* It moves the guess without settling it — no number suits both someone
who pays in an hour and someone away for a week. The manual version works because there is one
operator and a few calls.

A reader still has to know this row is exempt, so it carries `admin` as its source, a third value
beside `muster` and `xola`. *Rejected: a nullable expiry column* — that is the second stored number
§2.8.1 removed on purpose, and it can disagree with the first.

### What this costs

An unpaid booking holds a boat indefinitely and only a person frees it. If the operator stops
reading the purchases list, a boat quietly stops being sellable and nothing says so.
