/**
 * A read-through memo cache over a `Repository`, scoped to ONE derivation (#316).
 *
 * `deriveAtRiskBoard` reads the SAME crew's reliability log, credentials, and PTO
 * once **per shift** — directly, and transitively through the shared
 * `escalationTrailFor` / `solveShift` / `eligiblePool` / `rankedEligible`. On real
 * data that's `shifts × crew` serial round-trips (~10s). This decorator collapses
 * the duplicates: each idempotent per-key read runs at most once and every later
 * caller gets the memoized promise, without changing any of those shared
 * signatures.
 *
 * **Read-only + throwaway by contract.** Construct it fresh inside the derive and
 * discard it. NEVER hold it across a write or between renders — it has no
 * invalidation, so a longer-lived instance would serve stale data. The at-risk
 * derive path is pure reads (no `logReliabilityEvent`/`saveSeat`/…), so within one
 * render there is nothing to invalidate.
 *
 * **Cached results are SHARED references.** A memoized read hands the same array/
 * object to every caller this render, so callers must treat them as read-only —
 * never sort/push/splice a `repo.*` result in place (copy first). The at-risk
 * derive path already does (`.filter`/`.map` into fresh arrays); a future wrapper
 * of a call site that mutates in place would leak across consumers.
 *
 * **Built as a `Proxy`, not `Object.create(repo)`.** The Postgres adapter keeps
 * `#pool` as a true private field; an un-overridden method reached via a prototype
 * chain would run with `this` = the wrapper (never constructed by
 * `PostgresRepository`) and throw on `#pool`. The Proxy delegates every uncached
 * method with `this` bound to the real repo, so private fields resolve.
 */

import type { Repository } from "../ports/repository.js";

/** Idempotent no-arg reads — one memo slot each. */
const SINGLE = new Set(["listCrewMembers", "listShifts", "listEvents"]);

/** Idempotent reads keyed by their first (id) argument — one slot per key. */
const KEYED = new Set([
  "reliabilityEventsFor",
  "listCredentialsForCrew",
  "listPtoWindowsForCrew",
  "listSeatsForShift",
  "listAsksForSeat",
  "getShift",
  "getCrewMember",
]);

type AnyAsyncMethod = (...args: unknown[]) => Promise<unknown>;

/**
 * Wrap `repo` so the hot-path reads above are memoized for this instance's life.
 * Only those methods are cached; everything else (writes, CAS ops, the rest of
 * the port) delegates straight through, unchanged.
 */
export function memoizingRepo(repo: Repository): Repository {
  const single = new Map<string, Promise<unknown>>();
  const keyed = new Map<string, Promise<unknown>>();

  return new Proxy(repo, {
    get(target, prop) {
      const name = String(prop);
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      const fn = value as AnyAsyncMethod;

      if (SINGLE.has(name)) {
        return () => {
          let hit = single.get(name);
          if (!hit) {
            hit = fn.call(target);
            single.set(name, hit);
          }
          return hit;
        };
      }
      if (KEYED.has(name)) {
        return (...args: unknown[]) => {
          const key = `${name}:${String(args[0])}`;
          let hit = keyed.get(key);
          if (!hit) {
            hit = fn.apply(target, args);
            keyed.set(key, hit);
          }
          return hit;
        };
      }
      // Uncached method — bind to the real repo so `this`/private fields resolve.
      return fn.bind(target);
    },
  });
}
