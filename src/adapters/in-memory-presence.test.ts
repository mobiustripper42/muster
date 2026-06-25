/**
 * In-memory PresencePort adapter — runs the shared contract (#112). Passing the
 * same suite the Postgres adapter passes is what proves the double is
 * contract-equivalent.
 */
import { InMemoryPresence } from "./in-memory-presence.js";
import { runPresenceContract } from "./presence-contract.js";

runPresenceContract("in-memory", async () => new InMemoryPresence());
