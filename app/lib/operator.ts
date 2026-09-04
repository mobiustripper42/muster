/**
 * The operator's crew identity (DEC-030 operator-as-crew clause).
 *
 * BrewBoat reality: the operator (Eric) also captains, so the engine sometimes
 * asks HIM for a seat. In the outbox, an ask addressed to this crew member
 * renders inline Yes/No buttons (answerable right there, admin session) instead
 * of an `sms:` self-text — inline-or-relayed, never both, so the same ask can't
 * be answered through two doors at once.
 *
 * One tenant-config VALUE, not a handle-keyed map. Held the way existing tenant
 * config is held (a documented constant — the STAFFING_HORIZON_LEAD_DAYS shape),
 * env-overridable per deploy; a tenant-config table is a multi-tenant-era concern.
 * The dev default matches `db/seed-outbox-dev.ts`'s seeded operator.
 *
 * SLATED FOR REMOVAL (DEC-092): admins are now a first-class entity, and every
 * admin is crew. This single-operator VALUE — the "from the office" / inline-
 * answer sender — should be replaced by "is this crew member an admin" against
 * the `admins` set, so any admin (not just this one) is the office. That's a
 * DEC-030/058 messaging refactor, deliberately NOT folded into the DEC-092 auth
 * change; tracked as its own follow-up. Until it lands, this constant stands.
 *
 * Messaging (DEC-058): the operator participates as THIS crew id — posts and gets
 * doorbell-rung as `OPERATOR_CREW_MEMBER_ID` with the canonical `senderKind:
 * "admin"` ("from the office"). The durable admin entity now exists (DEC-092,
 * `admins` table) — the follow-up rewires this messaging sender to that set.
 */
export const OPERATOR_CREW_MEMBER_ID =
  process.env.OPERATOR_CREW_MEMBER_ID ?? "crew-eric-stoffer";
