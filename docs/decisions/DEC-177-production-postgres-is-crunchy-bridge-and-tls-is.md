---
schema: 1
id: DEC-177
title: "Production Postgres is Crunchy Bridge, and TLS belongs in the constructor"
topic: "Deployment, infra & versioning"
status: "active"
date: "2026-09-17"
ruling: "Hosted Postgres is Crunchy Bridge, not Neon. Its self-signed root is committed at `src/config/db-ssl.ts`, and `pgConnectionConfig` is applied inside every pg constructor — never by the caller."
claims:
  - kind: "file"
    target: "src/config/db-ssl.ts"
    note: "the CA and config builder; moved from app/lib so db/ can import it"
  - kind: "file"
    target: "src/adapters/postgres-repository.ts"
    note: "fromConnectionString applies the TLS config itself"
revisit_if: "Production Postgres moves again — then `docs/DEPLOY.md` and this record change together, not months apart"
---

## DEC-177: Production Postgres is Crunchy Bridge, and TLS belongs in the constructor

DEC-033 left the provider OPEN and it was never recorded afterwards. Neon was adopted in
practice, then replaced by Crunchy Bridge (issue #960) for cost, and neither move produced a
decision — which is why `docs/DEPLOY.md` named a deleted Neon project for weeks and the
pre-promote gate sent a session to a 404. See also DEC-033, whose Vercel, cron and
`production`-branch rulings stand.

Crunchy issues each team a self-signed root, so node's trust store rejects it. The certificate is
committed rather than configured: a CA carries only a public key, and an env var someone forgets
fails at connection time in production.

The trust decision sits inside the constructors because putting it on the caller was tried and
failed. PR #990 wired it into `app/lib/repo.ts` and one of eighteen callers had it. The other
seventeen are terminal scripts that never run in the request path, so the cutover looked seamless
for weeks — until the first one was pointed at production and refused with `no pg_hba.conf entry
… no encryption`, an error naming the caller's IP that reads like an allowlist problem.
