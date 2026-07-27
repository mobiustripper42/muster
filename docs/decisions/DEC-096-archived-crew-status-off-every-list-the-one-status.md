---
id: DEC-096
title: "`archived` crew status — off every list, the one status the override honors (#323)"
topic: "Crew, vessels & manning model"
---

## DEC-096: `archived` crew status — off every list, the one status the override honors (#323)

**Context.** `disable`/`inactive` (DEC-094 CLI) removes a crew member from the *automated* paths
(asks, pools, leans, escalation — the `isActive` gate), but the cockpit manual override picker
deliberately ignores status (DEC-064's "place anyone rated" backstop), so a disabled member still
appeared there. The operator needed a way to remove someone who no longer works here from **every**
list, including the manual picker — without a hard delete (history must survive; no-FK model).

**Decision.** A third `CrewStatus`, **`archived`**, distinct from `inactive`:
- `inactive` stays a **bench** — not auto-asked, but still manually placeable (unchanged; wanted).
- `archived` is **off every list** — it fails `isActive` (so out of all automated paths, like inactive)
  AND is filtered from the override picker AND rejected by `overrideSeat` (the action-layer guard,
  new `code: "archived"`), so a crafted post can't re-seat a removed member. This is the ONE status the
  override backstop honors — DEC-064's role floor still stands alongside it.
- **Not a delete:** reliability/ask/seat history is untouched; `db:crew unarchive` restores to `active`.
- Managed via `db:crew archive|unarchive` (siblings to enable/disable); `db:crew list` marks archived
  `✗` (vs `●` active / `○` inactive) so the operator sees + can restore them.

**No migration:** `crew_members.status` is a plain `text` column, so the new value round-trips with no
schema change (contract-tested on both adapters). **Revisit if:** a web roster surface lands (grey the
archived rows there too), or archived members should auto-hide from the roster after some retention.
