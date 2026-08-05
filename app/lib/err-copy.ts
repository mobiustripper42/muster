/**
 * Look up the copy for a redirect error code (#654).
 *
 * Server actions report failures as a code in a redirect param (DEC-026 — codes, not prose, so
 * the surface works with no client JS). Each surface owns a table mapping its codes to copy.
 *
 * **The bug this exists to prevent.** Those tables were `Record<string, string>` and read as
 * `ERR_COPY[sp.err] ?? ERR_COPY.error`. An unmapped code was not a type error — it silently
 * rendered the generic transient-retry line. The admin time-clock table shipped without a
 * `future` entry while its crew sibling had one, so an operator entering a future time was told
 * "try again in a moment" for a deterministic input rule: retrying reproduces the refusal
 * exactly, forever. A lookup that cannot fail is a lookup that cannot tell you it was wrong.
 *
 * So `table` is keyed to the surface's real code union and this function is the ONLY thing that
 * widens it. The generic `K` is inferred from the table, so a `fallback` that is not a key of it
 * is a build error too.
 *
 * **The runtime widening is deliberate and narrow.** `raw` comes off the URL, so it can be
 * anything a person types into the address bar. That case gets `fallback` — or `null` where the
 * surface has no generic line worth showing. What it can no longer do is mask a code the surface
 * is statically able to receive: adding a code to a domain result type now fails the build at
 * every surface that has to say something about it.
 */
export function errCopyFor<K extends string>(
  table: Readonly<Record<K, string>>,
  raw: string | undefined,
  fallback?: K,
): string | null {
  if (!raw) return null;
  const hit = (table as Readonly<Record<string, string | undefined>>)[raw];
  if (hit !== undefined) return hit;
  return fallback === undefined ? null : table[fallback];
}
