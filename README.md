# Muster

A reservation and operations system for small-passenger-vessel operators — a Xola replacement.
Customers book and pay for departures. Muster groups the resulting trips into **shifts** (one boat,
one day), works out who is legally allowed to crew each one, asks them in **reliability order**, and
surfaces only the shifts the automation couldn't close. First tenant: **BrewBoat**.

Crewing is the half Xola has no concept of: Xola knows a booking is paid; Muster knows whether
anyone will be standing on the dock to run it. It was built first, which is why older docs describe
the crew engine as though it were the whole product.

Built on a **policy/mechanism split** — the rules (USCG manning, credentials, turnaround) are
tenant-owned data; the engine that runs them is generic.

## Status

Project setup. Stack is **deliberately deferred to ~M4** (DEC-013): M0–M3 are a stack-agnostic
domain core (state machine, availability oracle, reliability log) behind a repository port.

## Docs

| File | What |
|------|------|
| [`docs/SPEC.md`](docs/SPEC.md) | 🔒 LOCKED v1.0 — the buildable source of truth |
| [`docs/FUTURE_IDEAS.md`](docs/FUTURE_IDEAS.md) | The shiny-object parking lot |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Generated topic index of architectural decisions (DEC-NNN) |
| [`docs/decisions/`](docs/decisions/) | The decisions themselves, one per file. Edit these, then `npm run gen:decisions` |
| [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) | Phases, tasks, velocity |
| [`docs/USER_STORIES.md`](docs/USER_STORIES.md) · [`docs/BRAND.md`](docs/BRAND.md) | Roles / voice |
| [`CLAUDE.md`](CLAUDE.md) | Project context for Claude Code |

Scaffolded from the [seeds](https://github.com/mobiustripper42/seeds) template (schema version 4).
