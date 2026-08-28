---
schema: 1
id: DEC-154
title: "The booking link is a stored code, so it can be revoked"
topic: "Reservations & payments"
status: "active"
date: "2026-08-14"
ruling: "A booking's manage link is a stored code that can be revoked, not a signed address that verifies itself. Nothing in production had ever minted the old kind, so replacing it cost nobody a working link."
claims:
  - kind: "spec"
    target: "§2.8.11"
  - kind: "file"
    target: "src/reservations/booking-code.ts"
  - kind: "column"
    target: "booking_codes.revoked_at"
revisit_if: "reservations go live and links reach customers, which closes the window in which link identity can be changed for free"
---

## DEC-154: The booking link is a stored code, so it can be revoked

The signed address was chosen deliberately and its cost was recorded at the time: no per-link
revocation, no expiry, no reissue. A leaked link died only by rotating the secret, which killed
every booking link at once.

Two things then came due together. The absence of revocation is why the operator's "copy manage
link" had to be kept off production, and the absence of reissue is why the resend built there
could only ever re-send the same immortal address.

What made the swap free was timing: the secret was never set in production, so not one booking
link existed in any customer's inbox. That window closes the day reservations go live, after
which every link already sent has to keep working forever.

The shape of the code, its length, and what a customer sees when one is refused are `SPEC.md`
§2.8.11 — they are how the system works, not a choice anyone needs the reasoning for.
