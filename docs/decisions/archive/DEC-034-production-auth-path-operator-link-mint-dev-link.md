---
id: DEC-034
title: "Production auth path — operator link mint, dev-link stays 404, NO email provider"
topic: "Crew self-serve, auth & admin identity"
---

## DEC-034: Production auth path — operator link mint, dev-link stays 404, NO email provider

**Status:** Accepted (Phase 5 / 5.2, #76) — @architect 2026-06-12; confirmed at build 2026-06-15.

**Decision:** The operator signs in to the deployed app via a **prod-minted magic link** — `db/mint-link.ts` (`npm run db:mint -- --admin=<handle>`), a bootstrap script run against the prod DB exactly like `db:migrate`. `/crew/dev-link` keeps its hard `NODE_ENV==='production'` **404**. **Crew** links need no new work: they already flow through the DEC-030 outbox relay (the script's `--crew=<id>` is a manual escape, not the normal path). Resolves the "no production auth path" tell of #70 (the Twilio swap + single-operator constant tells stay deferred — this is a *hosted pilot*, not production).

**Build specifics (confirmed 2026-06-15):** link TTL defaults to **60 min** (`--ttl-min` override) — longer than dev-link's 15 because the operator copy-pastes the URL out-of-band; still single-use. The script **requires `APP_BASE_URL`** and refuses to mint without it: a CLI has no request Host header to fall back on, and a link on the wrong origin is host-spoofable / unopenable (the footgun `app/lib/base-url.ts` documents). No new test — ops tooling alongside `db/tick-dev.ts` / `db/seed-*.ts`; the minted core (`issueMagicLink`/`randomSecret`) is covered in `src/auth/magic-link.test.ts`.

**Rejected:** an email/magic-link **delivery provider** — fails the dependency bar (the relay + a mint script get there with what we have) and it's a vendor pick the pilot doesn't need.
