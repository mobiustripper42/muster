---
id: DEC-044
title: "Crew seed carries a placeholder MMC until BrewBoat tracks real credentials"
topic: "Crew, vessels & manning model"
---

## DEC-044: Crew seed carries a placeholder MMC until BrewBoat tracks real credentials

**Status:** Built (Session 22). Originally `db/seed-pilot-crew.ts` seeded every crew member a far-future sentinel MMC expiry (`2099-12-31`); a real `mmcExpiry` overrides it per person as records are collected. **Since the pilot crew seed was removed** (2026-07-25) that script is gone and `db:crew add` (`src/crew/crew-cli.ts` → `PLACEHOLDER_MMC_EXPIRY`) is the sole owner of the sentinel — same value, same rationale.

**Why:** MMC is a **universal** hard credential gate (`src/oracle/eligibility.ts` → `HARD_CREDENTIAL_TYPES = ["MMC"]`) — no valid MMC → eligible for *no* seat, captain or mate. BrewBoat keeps **no MMC records today** (the operator has never had a tool; Muster will become that tool). Without a placeholder the eligible pool is empty and the board crews nobody. This is an **operator-authorized stopgap, not invented data** — the distinction that matters after DEC-016: the operator named the gap and chose the placeholder, and a real (or lapsed) date replaces the sentinel the moment it exists.

**How to apply:** do not treat the `2099-12-31` MMC as a bug. When MMC tracking lands in Muster, replace the sentinel with captured expiries; a lapsed date then correctly drops that person from the eligible pool.
