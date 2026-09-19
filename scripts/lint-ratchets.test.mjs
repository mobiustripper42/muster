import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

/**
 * Proof that the zero-finding lint rules actually fire (#904).
 *
 * **These four rules have no findings in the repo, which is exactly why they need a
 * test.** A selector that matches nothing and a selector that is silently broken produce
 * the identical result — a clean `npm run lint` — and nothing else in the gate can tell
 * them apart. Without this file, a typo in an `esquery` selector would sit in the config
 * looking like enforcement for as long as nobody wrote the bug it was meant to catch.
 *
 * That is not a hypothetical about some other codebase. Issue #904 exists because #854's
 * prose convention was broken 109 times, and the rule that replaced it found 3× what a
 * hand grep did. A rule nobody has seen fail is in the same position as the prose was.
 *
 * ## Each rule is tested from both ends
 *
 * The `bad` cases prove it fires. **The `good` cases are the load-bearing half** — three
 * of these four rules have a near neighbour that is correct and common, and a selector
 * that cannot tell them apart is worse than no rule: it trains people to add disables.
 *
 *  - `redirect()` in a CATCH block is the right idiom, and there are 15 in `app/` today.
 *  - `test.skip(condition, reason)` is the environment gate that still reports a reason;
 *    `playwright/no-skipped-test` measured 8 findings of which 7 were exactly that, which
 *    is why it is off and this narrower rule is on. An `if`-gated `describe.skip` is NOT a
 *    good case and is flagged — same silence, harder to see.
 *  - `(cents / 100).toLocaleString("en-US")` is money formatting, not a clock — 8 findings,
 *    8/8 false positives, which is why the clock rule names `toLocaleDateString` and
 *    `toLocaleTimeString` and not the bare `toLocaleString`.
 *
 * ## Why this lints a fixture rather than a file on disk
 *
 * `lintText` with a `filePath` resolves the real `eslint.config.mjs` against that path, so
 * this exercises the SHIPPED config — the same composition, the same block ordering — and
 * catches the failure that actually happened while writing #904: a new block replacing an
 * earlier block's selectors, because flat config overwrites rule options rather than
 * merging them. A test that built its own config would have passed through that.
 */

const eslint = new ESLint();

/** Which messages from the real config fired on this snippet, at this path. */
async function violations(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax");
}

const CASES = [
  {
    rule: "the clock rule — toLocale*String without a timeZone",
    filePath: "app/(admin)/admin/probe-page.tsx",
    bad: [
      ['d.toLocaleTimeString("en-US", { hour: "numeric" });', "a time with no zone"],
      ['d.toLocaleDateString("en-US", { month: "short" });', "a date with no zone"],
      ["d.toLocaleDateString();", "no arguments at all"],
    ],
    good: [
      ['d.toLocaleTimeString("en-US", { hour: "numeric", timeZone: TENANT_TIMEZONE });', "vessel-local"],
      ['d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });', "a date-only label"],
      ['(cents / 100).toLocaleString("en-US");', "money, not a clock"],
    ],
  },
  {
    rule: "redirect() inside a try block",
    filePath: "app/(admin)/admin/probe/page.tsx",
    bad: [
      ['try { redirect("/a"); } catch (e) { log(e); }', "directly in the try"],
      ['try { if (x) { redirect("/a"); } } catch (e) { log(e); }', "nested inside the try"],
    ],
    good: [
      ['try { work(); } catch (e) { redirect("/a"); }', "in the catch — the correct idiom"],
      ['try { work(); } finally { cleanup(); }\nredirect("/a");', "outside the try entirely"],
    ],
  },
  {
    rule: "a server action that throws",
    filePath: "app/(admin)/admin/probe/actions.ts",
    bad: [
      ['export async function a() { throw new Error("no"); }', "a bare throw"],
      ["export async function c() { try { x(); } catch (e) { throw e; } }", "a rethrow"],
    ],
    good: [
      ['export async function b() { return { error: "handled" }; }', "returning the error"],
      ['export async function d() { redirect("/ok"); }', "redirect is not a ThrowStatement"],
    ],
  },
  {
    rule: "an unconditionally skipped e2e suite",
    filePath: "e2e/probe.spec.ts",
    bad: [
      ['test.describe.skip("dark forever", () => {});', "at the top level"],
      ['describe.skip("also dark", () => {});', "a bare describe.skip"],
      [
        'test.describe("outer", () => { test.describe.skip("inner", () => {}); });',
        "NESTED — the case the first cut's `Program >` anchor let through, and this suite nests routinely",
      ],
      [
        'if (!dbUp) test.describe.skip("gated", () => {});',
        "if-gated — flagged deliberately; a skipped describe vanishes from the report with no reason",
      ],
    ],
    good: [
      ['test.describe("live", () => {});', "a live suite"],
      ['test.skip(!dbUp, "needs a database");', "the idiom that reports the reason"],
      ['test.describe("outer", () => { test.skip(!dbUp, "gate"); });', "gating tests inside a live suite"],
    ],
  },
];

describe.each(CASES)("$rule", ({ filePath, bad, good }) => {
  it.each(bad)("fires on %s (%s)", async (code) => {
    expect(await violations(code, filePath)).not.toHaveLength(0);
  });

  it.each(good)("stays quiet on %s (%s)", async (code) => {
    expect(await violations(code, filePath)).toHaveLength(0);
  });
});

/**
 * The regression that prompted the composition rule, pinned.
 *
 * Flat config REPLACES a rule's options rather than merging them, so a block added for
 * `app/**` drops every selector an earlier `app/**` block had. The first cut of #904 did
 * exactly that and switched off issue #854's bare-`catch {}` ban across `app/` and
 * `components/`. It surfaced only because eleven files happened to carry `eslint-disable`
 * comments that went unused.
 *
 * This asserts the older rules still reach the directories a #904 block touches. It fails
 * if anyone adds a `no-restricted-syntax` block without spreading what was already there.
 */
describe("#904's blocks did not shadow the rules that came before them", () => {
  it.each([
    ["app/(admin)/admin/probe/page.tsx", "app/** keeps #854's catch ban"],
    ["app/(admin)/admin/probe/actions.ts", "the narrower actions.ts block keeps it too"],
    ["components/probe.tsx", "components/** keeps it"],
    ["src/probe.ts", "src/** keeps #902's version"],
  ])("%s — %s", async (filePath) => {
    const found = await violations("try { x(); } catch { }", filePath);
    expect(found).not.toHaveLength(0);
  });
});
