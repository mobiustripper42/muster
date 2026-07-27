---
id: DEC-135
title: "The \"Your booking\" manage page ships view + post-tip + cancel/change-as-request; self-service cancel is deferred (12.6, #459)"
topic: "Reservations & payments"
---

## DEC-135: The "Your booking" manage page ships view + post-tip + cancel/change-as-request; self-service cancel is deferred (12.6, #459)

**Decision:** the capability-URL manage page (`/reservations/manage`, DEC-122) ships its read surface (both trip-time states: **upcoming** = trip + balance; **completed** = post-trip tip + receipt), the DEC-124 **post gratuity** (hosted Checkout), **add-to-calendar** (a token-gated `.ics`), **book-again**, and the contact's **other trips**. The money reuses `buildReservationDetail` (one source of truth with the admin pane); the customer extras live in a pure `manage-view.ts` (phase flip, post-tip tiers, back-by/arrive-by).

**Cancel & change are option (b): an out-of-band request emailed to the operator**, NOT self-service. Self-service cancel-with-refund is deferred — it needs the #472 refund policy (the DEC-107 amendment) *and* Flex-insurance-on-reservation wiring (add-ons aren't attached to reservations yet), neither of which exists. Rather than fake "self-service for Flex holders," the customer requests a cancel/change and the operator handles it manually (the model `booking-link.ts` already described). Option (c) — real self-service — layers on later; (b) is needed regardless. Delivery: a best-effort email to `OPERATOR_NOTIFY_EMAIL` via a new `booking_request` `MessageKind` (the app had no operator-email-alert path — the webhook's own admin alert is still a `console.error` TODO; this is the first, minimal one). "Message us reaches the operator, never the crew" (mockup, 2026-07-17).

**Bearer-token loosening recorded (DEC-122):** the manage page lists the *contact's other reservations* (by `customerId`), each with its own minted link — so holding any one link surfaces that contact's trips. Accepted (same person), a conscious loosening.

**Deferred to follow-ups (infra not built):** crew NAMES (the view model gives counts, not names); the guest waiver roster ("N of M signed" — there's no per-attendee roster, DEC-110 is one consent row); leave-a-review; email-the-receipt; and the date/time *reschedule* (re-hold + re-price is its own feature). The re-estimate: the full mockup is an 8+, not the issue's 5 — this ships the honest core and flags the rest. **Depends on DEC-134** (reads `Payment.serviceFeeCents` for the "Tax + service fee" line — 12.6 stacks on 12.5).
