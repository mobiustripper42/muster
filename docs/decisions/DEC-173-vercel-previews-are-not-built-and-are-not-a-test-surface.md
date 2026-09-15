---
schema: 1
id: DEC-173
title: "Vercel previews are not built, and are not a test surface"
topic: "Deployment, infra & versioning"
status: "active"
date: "2026-09-15"
ruling: "Only the `production` ref builds; every other branch is cancelled by a dashboard Ignored Build Step. The `VERCEL_ENV` dev-link gate is unchanged, but its preview branch is now unreachable, so local dev is the only place the minter is live."
claims:
  - kind: "file"
    target: ".claude/CLAUDE-context.md"
    note: "states the rule beside the Surface check slot"
  - kind: "file"
    target: "app/lib/base-url.ts"
    note: "the preview branch, chosen by env vars not by the platform"
  - kind: "file"
    target: "app/(crew)/crew/dev-link/route.ts"
    note: "DEC-057's gate; unchanged, local-only"
supersedes:
  - DEC-057
revisit_if: "A preview has a database again, or a promote needs a rehearsal local dev cannot give"
---

## DEC-173: Vercel previews are not built, and are not a test surface

DEC-057's own revisit condition fired: *"previews ever stop being isolated branches."* They did.

It contained an unauthenticated session minter on preview URLs with two arguments, and the first is
gone. A preview's `DATABASE_URL` is not an isolated Neon branch, because there is no preview
database: branch-per-preview produced a large bill and the project was deleted 2026-09-15. The
second holds — `SESSION_SECRET` must be set on Preview or the mint throws.

DEC-057 reasoned that previews are where Vercel-only failure modes surface, so a preview you cannot
log into cannot catch them. Moot once previews do not build.

A preview serving pages without a database was worse than none: it looked testable. Two hand-test
plans were written against one the same day and neither could run.

What this gives up is a rehearsal between `main` and `production`. Acceptable, because the preview
code path is chosen by env vars, not by the platform:
`VERCEL_ENV=preview VERCEL_URL=<host> npm run dev` exercises it locally.
