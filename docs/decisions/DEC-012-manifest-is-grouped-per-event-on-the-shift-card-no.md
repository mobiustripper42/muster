---
id: DEC-012
title: "Manifest is grouped per event on the shift card; no waivers for crew"
topic: "Crew, vessels & manning model"
---

## DEC-012: Manifest is grouped per event on the shift card; no waivers for crew

**Decision:** The guest manifest is grouped **by event** on the shift card (a Saturday shift shows
separate 1pm/3pm/5pm lists), each showing **name + count/phone**. **Waivers are not shown to crew.**
Pull this onto the card **early** — it is the **hinge** that ends the Xola dependency.
**Why:** Different customers are on each event; crew need per-event lists. The moment the card is
authoritative, crew stop needing Xola and the 2026 write-back sheet retires (SPEC §0.4, §2.6.3).
**Tradeoff:** Requires the CSV export to carry guest name+phone per reservation (verify at M1).
**Revisit if:** Export lacks guest detail → fall back to the write-back sheet (DEC-011) as a stopgap.
**M1 verification (DEC-015 / DEC-017):** guest name + party are inline and phone joins via the
customers export → the manifest is fed from the import; the "export lacks detail" fallback did **not**
fire. Manifest contact fields are name + party + (nullable) phone.
