/**
 * Trailing-slash normalisation for a base URL, in one place (#908).
 *
 * This replaced **23 copies of the same trailing-slash regex** spread across
 * `src/`, `app/` and `db/` — every one of them normalising a base URL before a
 * link was built on it. The duplication was invisible to the gate:
 * `sonarjs/no-identical-functions` is per-file (see its note in
 * `eslint.config.mjs`), so twenty-three identical expressions in twenty-one files
 * produced no finding at all. What surfaced it was `sonarjs/super-linear-regex`,
 * flagging the same expression twenty-three times.
 *
 * **Why not a regex.** The old form backtracked: the engine retries the
 * slash-run match from successive start positions before the end anchor settles
 * it, which is quadratic in the length of the run. On a 100k-slash string it does
 * not finish in any useful time; the loop below does it in a single pass, and
 * `base-url.test.ts` asserts that rather than trusting it.
 *
 * **This is not a live vulnerability, and the rule was not reporting one.** All 23
 * call sites feed it `APP_BASE_URL` or an equivalent config value, and the one
 * place a client-controlled `Host` header can reach a base URL
 * (`app/lib/base-url.ts`) returns without normalising at all. The rule is on
 * because a quadratic regex in a URL helper is a bad thing to keep — and now there
 * is one place to look if a caller ever starts passing something an attacker
 * controls.
 *
 * Framework-free, so `app/` reaches it through `@core/*` and `db/` by relative
 * path, which is the only way one helper can serve all 23.
 */

/**
 * The overload is load-bearing, not decoration. Six of the call sites used optional
 * chaining on the env var, so an unset `APP_BASE_URL` yielded `undefined` and the
 * caller branched on it. A helper typed `(s: string) => string` would have quietly
 * turned those into `""` — falsy in the same places, but NOT the same value: it
 * builds `"/b/CODE"`, a relative link that goes nowhere, where the code meant to
 * skip building a link at all.
 */
export function stripTrailingSlashes(s: string): string;
export function stripTrailingSlashes(s: string | undefined): string | undefined;
export function stripTrailingSlashes(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* "/" */) end -= 1;
  return end === s.length ? s : s.slice(0, end);
}
