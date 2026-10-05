---
schema: 1
id: DEC-194
title: "A discount is dollars off the fare; a comp confirms by name, without a payment"
topic: "Reservations & payments"
status: "active"
date: "2026-10-05"
ruling: "One dollar box on an unpaid operator booking. Tax, fee and tip follow the discounted base. Under $2 due is a comp, and a comp confirms through a second, named lookup into the same flip."
claims:
  - kind: "spec"
    target: "2.8.4a"
  - kind: "spec"
    target: "2.8.6"
  - kind: "spec"
    target: "2.10.6"
revisit_if: "Post-trip tipping is ever added, or the operator wants percent discounts or codes"
amends_spec:
  - section: "2.8"
    scope: "2.8.4a gains a discount component and the $2 comp floor; 2.8.6 gains a second, named confirm for a comp"
  - section: "2.10"
    scope: "2.10.6 gains the discount box on an unpaid operator booking"
---

## DEC-194: dollars off, and a comp confirms by name

Operator, 2026-10-05 (16.4, gap C).

- **Dollars, not percent.** A comp is "type the fare". Percent, reasons and codes were cut as
  more than a rarely used box needs.
- **Under $2 due becomes a comp**, said on the box before saving: collecting a dollar or two
  is not worth anyone's time. A code constant, not a setting; Stripe's own floor is $0.50.
- **A comp zeroes the tip.** A free cruise that bills the crew's share is not free; guests tip
  in cash.
- **A second lookup, not a second write.** A $0 booking has no payment id, so the comp finds
  its row by reservation id and runs the same flip. A fake $0 payment was the alternative.

The rates stay frozen; only the base moves.
