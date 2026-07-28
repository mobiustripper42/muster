# Muster

A **crew engine** for small-passenger-vessel operators. Muster turns a week's reservations into
discrete **shifts** (one boat, one day), works out who is legally allowed to crew each shift, asks
them in **reliability order**, and surfaces only the shifts the automation couldn't close. The half
of an eventual Xola replacement that Xola has no concept of: it knows whether anyone will be on the
dock to run the trip. First tenant: **BrewBoat**.

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
