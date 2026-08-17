---
id: DEC-127
title: "DECISIONS.md carries a topic index at the top; every new DEC updates it"
topic: "Core architecture & engine mechanics"
---

## DEC-127: DECISIONS.md carries a topic index at the top; every new DEC updates it

**See also** — later decisions that changed part of this one:
- Amended by DEC-141 — the maintenance rule only — the index stands, but it is generated rather than hand-updated

**Decision:** The file opens with an `## Index` — decisions grouped by topic, each pointing to the current DEC, superseded ones struck through and pointed at their replacement. Past ~120 DECs, "what's our current call on X" was a grep; the index makes it a lookup.

**Maintenance rule (the load-bearing part):** every new DEC adds its row to the index under a topic, and any DEC it supersedes gets struck through there and pointed at the new one. An index nobody maintains is worse than none — so this is part of writing a DEC, not a separate chore. Treat a missing index row as a defect in review.

**Why this is a DEC at all:** an index is doc hygiene, not architecture — but the *maintenance convention* is durable and worth recording, which is the only thing this DEC pins.
