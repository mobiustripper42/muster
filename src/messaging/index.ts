/**
 * Messaging barrel (#111, DEC-051 / DEC-045). The in-app message store —
 * threads, participants, messages — the derived-membership rule, the pure
 * doorbell presence classifier (#112), and the doorbell decider (#114). No UI,
 * no doorbell tick here (delivery lands in 6.6); this is the substrate + the
 * pure decision core.
 */

export * from "./entities.js";
export * from "./membership.js";
export * from "./presence.js";
export * from "./doorbell-decider.js";
