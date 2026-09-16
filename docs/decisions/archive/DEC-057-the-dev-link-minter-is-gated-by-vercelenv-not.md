---
id: DEC-057
title: "The dev-link minter is gated by `VERCEL_ENV`, not `NODE_ENV` — live on previews, off in prod"
topic: "Crew self-serve, auth & admin identity"
---

## DEC-057: The dev-link minter is gated by `VERCEL_ENV`, not `NODE_ENV` — live on previews, off in prod

**Status:** Built (Session 24).

**Decision:** `/crew/dev-link` (the hand-driven magic-link minter for **both** crew `?crew=<id>` and
operator `?admin=<handle>`) gates on `VERCEL_ENV` instead of `NODE_ENV`, with a `NODE_ENV` fallback so
the prod-404 holds **host-agnostically**:
`VERCEL_ENV === "production" || (!VERCEL_ENV && NODE_ENV === "production")`. So it is **404 on every
production deploy** — Vercel prod (`VERCEL_ENV="production"`) *and* a self-hosted prod (`next start` /
Docker, where `VERCEL_ENV` is absent but `NODE_ENV="production"`) — and **live on Vercel previews**
(`VERCEL_ENV="preview"`) and **local dev** (`VERCEL_ENV` unset, `NODE_ENV!=="production"`). Pairs with
`APP_BASE_URL` **scoped to the Production env only** in Vercel — left unset for Preview, `base-url.ts`
falls back to the request `Host`, so a minted link's origin resolves to the preview's own domain
(DEC-034 host-spoof guard intact: prod still has the trusted origin set).

**Why:** Vercel sets `NODE_ENV=production` on **preview** builds too, so the old `NODE_ENV` gate 404'd
previews — killing the only sign-in path (crew or admin) and making a preview impossible to smoke-test
before `/promote-production`. Previews are exactly where the Vercel-only failure modes (cold starts,
pool limits, cron, host/`APP_BASE_URL` bugs) surface; a preview you can't log into can't catch them.
`VERCEL_ENV` distinguishes prod-vs-preview where `NODE_ENV` can't.

**Tradeoff:** the unauthenticated minter is now reachable on preview URLs — anyone with the (obscure,
non-secret) preview link can mint a crew/operator session. **Contained two ways:** (1) a preview's
`DATABASE_URL` is its own **isolated Neon branch** (a clone, never prod), so a minted preview session
touches branch data only; and (2) minting requires `SESSION_SECRET` set on the Preview env — on a
preview `NODE_ENV="production"`, so `auth.ts`'s `secret()` **throws** rather than signing with the
repo-public dev default, meaning a bare preview URL can't forge a valid session without that secret.
The prod deploy itself stays hard-404 on every host. **Rejected:** a preview-only shared secret on the
route (ceremony the contained blast radius doesn't warrant); leaving it `NODE_ENV`-gated + minting
admin links out-of-band via `db:mint` against each preview branch (the friction this fix exists to
remove). **Revisit if:** previews ever stop being isolated branches, or carry sensitive data — then re-gate.
**Phase:** out-of-phase pilot-infra (#135).
