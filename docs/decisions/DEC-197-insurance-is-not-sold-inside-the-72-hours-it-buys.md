---
schema: 1
id: DEC-197
title: "Insurance is not sold inside the 72 hours it buys"
topic: "Reservations & payments"
status: "active"
date: "2026-10-13"
ruling: "Cancellation insurance is offered only when departure is 72 hours or more away, on both checkout and the phone booking. Inside that line the box is not shown, and a write that asks for it is refused, not silently dropped."
claims:
  - kind: "spec"
    target: "2.8.4c"
  - kind: "file"
    target: "src/reservations/availability.ts"
revisit_if: "Insurance ever buys something besides the 72-hour refund line"
amends_spec:
  - section: "2.8"
    scope: "2.8.4c: insurance is not offered inside 72 hours of departure, and is refused there"
---

## DEC-197: no insurance inside its own window

Operator, 2026-10-13, reviewing 16.8 (issue #683). See also DEC-195.

- **It would buy nothing.** Insurance buys a refund for cancelling 72 hours or more out. Bought at
  71 hours, it is $30 for a refund that can no longer happen.
- **One line, the refund's.** `insuranceOnSale` measures the same 72 hours as `refundOwedCents`, and
  is inclusive the same way. The two can't drift apart.
- **Refused, not dropped.** A page that offered it can outlive the line. Dropping the $30 on submit
  would charge a total the customer never saw, so the write refuses by name and charges nothing.
- **The sale is when it's priced.** An intent or payment link priced outside the line stays
  payable after it passes. The customer saw that total, and refusing it would strand them.
- **The operator too.** The phone booking gets the same rule. An operator passes the booking cutoff
  because it protects their own notice. This rule protects the customer.
