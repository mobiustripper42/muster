---
schema: 1
id: DEC-193
title: "The public site stops selling inside the booking cutoff; the phone still books"
topic: "Reservations & payments"
status: "active"
date: "2026-10-02"
ruling: "A setting in hours, fallback 0, computed from the clock. Inside it the public site refuses and says call us; the operator passes."
claims:
  - kind: "spec"
    target: "2.8.4"
  - kind: "spec"
    target: "2.10.2"
  - kind: "spec"
    target: "2.10.6"
revisit_if: "Same-day demand grows and the operator wants unattended last-minute sales back"
amends_spec:
  - section: "1.3"
    scope: "the lead-time cutoff bullet is narrowed; the booking cutoff is a different rule"
  - section: "2.8"
    scope: "2.8.4: a departure inside the booking cutoff is not offered and is refused at checkout"
  - section: "2.10"
    scope: "2.10.2 gains the cutoff state; 2.10.6 points at it"
---

## DEC-193: the public site stops selling inside the booking cutoff

Operator, 2026-08-29 (audit Gap B) and 2026-10-02.

- **A system setting**, in `app_settings`, in **hours**. The code fallback is **0**, meaning no
  cutoff, so nothing changes until the operator sets one. Edited on `/admin/settings`.
- **Computed, never stored**: a clock check when availability is read.
- **Its own state**, not `blocked`, so the Blocked count stays honest and the customer is told to
  call rather than seeing "not for sale".
- **Both paths**, the availability read and the claim. The claim's rules carry it as data:
  customer refuses, operator passes.

This narrows §1.3's rejected lead-time cutoff (first ruled in DEC-140, now retired). Only the
unattended online sale inside the cutoff stops; before it, and at the fallback, §1.2 runs as it did.
The write refuses it by name, beside `departed`, and never at confirm.

Not the **booking horizon** or the **staffing horizon**. The operator picks the number with crew
notice in mind, but it is not `STAFFING_HORIZON_LEAD_DAYS`.

See also DEC-140 (archived).
