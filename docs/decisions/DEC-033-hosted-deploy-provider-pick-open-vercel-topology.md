---
id: DEC-033
title: "Hosted deploy — provider pick (OPEN), Vercel topology, `tick` cron, `production` branch"
topic: "Deployment, infra & versioning"
---

## DEC-033: Hosted deploy — provider pick (OPEN), Vercel topology, `tick` cron, `production` branch

**Status:** Proposed (Phase 5 / 5.1) — @architect 2026-06-12. **Provider sub-decision OPEN (owner/Eric — money + account lead time).**

**Decision (proposed):** First hosted deploy — fires the deferred triggers: DEC-020 (host deferred to "first task needing a real URL" — crew phones need one), DEC-023 (wire the `tick` cron caller at first deploy), DEC-S022 (`production` branch adopts here). Next app on **Vercel** (`next build --webpack`, DEC-020); a **CRON_SECRET-guarded cron route** calls `tick` on a schedule (`now` injected) so the engine self-advances unattended — without it a deployed Muster never ticks, failing "no babysitting"; `production` branch + `/promote-production` stand up per DEC-S022.

**OPEN — hosted Postgres provider:** candidates Supabase (CLAUDE.md-named candidate, *not adopted*), Neon, Railway, etc. Owner decision (cost + account lead time) — **the phase's long pole; decide before 5.1 builds.** The in-memory adapter stays as the test substrate (DEC-DATA-1). The schema is plain Postgres DDL — vendor-agnostic behind the port.
