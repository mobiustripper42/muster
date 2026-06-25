/**
 * Messaging barrel (#111, DEC-051 / DEC-045). The in-app message store —
 * threads, participants, messages — the derived-membership rule, and the pure
 * doorbell presence classifier (#112). No UI, no doorbell decider/tick here
 * (those land in later Phase 6 tasks); this is the substrate.
 */

export * from "./entities.js";
export * from "./membership.js";
export * from "./presence.js";
