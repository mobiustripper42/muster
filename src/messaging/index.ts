/**
 * Messaging barrel (#111, DEC-051 / DEC-045). The in-app message store —
 * threads, participants, messages — plus the derived-membership rule. No UI, no
 * doorbell here (those land in later Phase 6 tasks); this is the substrate.
 */

export * from "./entities.js";
export * from "./membership.js";
