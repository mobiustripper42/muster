/**
 * The operator's crew identity (DEC-030 operator-as-crew clause).
 *
 * BrewBoat reality: the operator (Spink) also captains, so the engine sometimes
 * asks HIM for a seat. In the outbox, an ask addressed to this crew member
 * renders inline In/Out buttons (answerable right there, admin session) instead
 * of an `sms:` self-text — inline-or-relayed, never both, so the same ask can't
 * be answered through two doors at once.
 *
 * One tenant-config VALUE, not a handle-keyed map: admin handles are free-form
 * non-identities (DEC-020 — there is no admin entity) and the session stays
 * single-subject. Held the way existing tenant config is held (a documented
 * constant — the STAFFING_HORIZON_LEAD_DAYS shape), env-overridable per deploy;
 * a tenant-config table is a multi-tenant-era concern. The dev default matches
 * `db/seed-outbox-dev.ts`'s seeded operator.
 *
 * Messaging (DEC-058): the operator participates as THIS crew id — posts and gets
 * doorbell-rung as `OPERATOR_CREW_MEMBER_ID` with the canonical `senderKind:
 * "admin"` ("from the office"). No durable operator entity is minted here; that
 * stays the parked admin-roles revision of DEC-020.
 */
export const OPERATOR_CREW_MEMBER_ID =
  process.env.OPERATOR_CREW_MEMBER_ID ?? "crew-spink";
