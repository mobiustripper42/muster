/**
 * Which server a project drives, and how much slack that earns (#763, #1169).
 *
 * The prebuilt server (`next start`) answers a test in 1–2s; `next dev` compiles routes on demand
 * and takes 4–9s for the same specs. One set of timeout constants cannot be right for both, and
 * the constants were written for the fast one — so the slow path sat permanently near every
 * ceiling and tipped over under load, failing at whichever step the clock happened to land on.
 * Multiply, don't re-pick.
 *
 * **Since #1169 the server is per project, not per run.** Setup, desktop and mobile drive the
 * prebuilt server; the iPhone project drives `next dev` (`playwright.config.ts` says why). So the
 * multiplier is looked up from the running project's `metadata.server`, by `slowPath()` in
 * `fixtures.ts` at test time and by the config when it sets each project's budgets.
 *
 * **This file exists so there is exactly one spelling of the rule.** The first cut of #763 defined
 * the multiplier inside `playwright.config.ts` and silently missed the hydration poll in
 * `fixtures.ts`; the second duplicated the predicate and got the CI case backwards. One table here,
 * read by both.
 */

export type E2EServer = "prebuilt" | "dev";

/** Multiply every timeout by this. 1 on the prebuilt server, 2 on the compile-on-demand one. */
export const SLOW_PATH_FOR: Record<E2EServer, number> = { prebuilt: 1, dev: 2 };

/** The server a project's metadata names. Throws on a project that names none, rather than guess. */
export function serverOf(metadata: Record<string, unknown> | undefined): E2EServer {
  const server = metadata?.server;
  if (server === "prebuilt" || server === "dev") return server;
  throw new Error(
    `e2e project has no metadata.server (got ${JSON.stringify(server)}) — every project in ` +
      `playwright.config.ts names the server it drives.`,
  );
}

/** The project that drives `next dev`. */
export const DEV_PROJECT = "iphone";

/**
 * Whether this run needs the `next dev` server (#1169). Playwright boots every web server at launch,
 * whatever `--project` asks for, so a local `--project=desktop` run would pay for a dev server it
 * never uses. No `--project` means every project, so yes; a pattern (`*`) might match it, so yes;
 * otherwise only if the iPhone project is named.
 */
export function needsDevServer(argv: readonly string[]): boolean {
  const named: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--project=")) named.push(a.slice("--project=".length));
    else if (a === "--project" && argv[i + 1] != null) named.push(argv[++i]!);
  }
  if (named.length === 0) return true;
  // Playwright matches `--project` case-insensitively, so this does too.
  return named.some((n) => n.toLowerCase() === DEV_PROJECT || /[*?[]/.test(n));
}
