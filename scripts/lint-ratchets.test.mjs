import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

/**
 * Proof that the zero-finding lint rules actually fire (#904), plus #951's token ban.
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
  {
    /**
     * The odd one out: this rule shipped with 138 findings, not zero (#951). It is tested
     * here anyway because the `good` cases are three separate carve-outs that a slightly
     * wrong regex would eat — and a rule that flags `border-faint` or `disabled:text-faint`
     * is a rule people turn off rather than obey.
     */
    rule: "`text-faint` on anything a person reads (#951)",
    filePath: "app/(admin)/admin/probe/page.tsx",
    bad: [
      ['<p className="text-xs text-faint">Scanned 12 rows</p>;', "a plain className"],
      [
        "<p className={`${base} text-faint line-through`}>{d}</p>;",
        "inside a TEMPLATE LITERAL — 12 of the 138 were this, and a Literal-only selector misses every one",
      ],
      [
        '<input className="placeholder:text-faint" />;',
        "a placeholder is read by the person deciding what to type — deliberately NOT carved out",
      ],
      ['const c = "rounded-full text-faint";', "hoisted out of the JSX into a const"],
    ],
    good: [
      ['<p className="text-xs text-muted">Scanned 12 rows</p>;', "the AA-passing tone"],
      // `disabled:text-faint` WAS a good case here (WCAG 1.4.3 exempts an inactive control). It
      // moved to the #1103 case below as a BAD one: disabled styling is now set once in
      // globals.css, so any hand-written `disabled:` class is refused, faint or not.
      ['<div className="rounded-box border border-faint" />;', "a border is not text"],
      ['<span className="bg-faint" />;', "a fill is not text"],
      ['<p className="text-muted">faint is 2.36:1</p>;', "the word alone, with no class attached"],
    ],
  },
  {
    /**
     * Four button kinds, pointer and disabled set once (#1103). The `good` cases are the three
     * shapes a correct button takes — a literal, a ternary of literals, a selection control that
     * is not an action button — so a selector that eats one of them is caught here.
     */
    rule: "an action button names its kind; pointer and disabled are never hand-written (#1103)",
    filePath: "app/(admin)/admin/probe/page.tsx",
    bad: [
      ['<SubmitButton className="rounded-box bg-accent px-4 text-white">Save</SubmitButton>;', "no kind"],
      ["<SubmitButton>Save</SubmitButton>;", "no className at all"],
      ["<GetFormSubmit className={cls}>Show</GetFormSubmit>;", "a class the guard cannot read, via a variable"],
      ['<DirtySubmit className="min-h-[44px] bg-ok text-white">Save</DirtySubmit>;', "the wrapper that slipped past once"],
      ['<a href="/x" className="rounded-box bg-accent px-4 text-white">Go</a>;', "a link dressed as a filled button"],
      ['<button type="button" className="cursor-pointer">x</button>;', "a hand-written pointer"],
      ['<button disabled className="text-xs disabled:text-faint">Go</button>;', "a hand-written disabled style"],
    ],
    good: [
      ['<SubmitButton className="btn-primary w-full">Save</SubmitButton>;', "a kind plus layout"],
      ['<SubmitButton className={x ? "btn-secondary" : "btn-danger"}>Go</SubmitButton>;', "a ternary of kinds"],
      ['<button type="button" className="rounded-box border border-line px-1">15%</button>;', "a selection tile"],
      ['<AppLink href="/x" className="btn-quiet text-xs">Change</AppLink>;', "a quiet link keeping its size"],
    ],
  },
  {
    /**
     * One radius (issue #484, part 5). Every box is `rounded-box`; the `good` cases are the three
     * other shapes the rule must let through — a pill, an undo, and a mark that declares itself —
     * plus the word in copy, which a token match that ignored word boundaries would eat.
     */
    rule: "one radius for every box (issue #484)",
    filePath: "app/(admin)/admin/probe/page.tsx",
    bad: [
      ['<div className="rounded-lg border" />;', "a Tailwind scale radius"],
      ['<div className="rounded-[9px] border" />;', "an arbitrary radius"],
      ['<span className="rounded border px-1" />;', "bare `rounded` — Tailwind's own 4px"],
      ['<div className="rounded-t-lg" />;', "a side variant"],
      ['<div className="sm:rounded-xl" />;', "behind a variant prefix"],
      ["<div className={`rounded-${size} border`} />;", "a dynamic radius, in a template literal"],
      ['<div className="rounded-card border" />;', "the old card name, gone with the rename"],
    ],
    good: [
      ['<div className="rounded-box border" />;', "the box radius"],
      ['<div className="rounded-t-box border-b" />;', "one side of the box radius"],
      ['<span className="rounded-full bg-ok px-2" />;', "a pill"],
      ['<div className="rounded-box sm:rounded-none" />;', "undoing one"],
      [
        '// eslint-disable-next-line no-restricted-syntax -- mark (issue #484)\nconst KEY = "h-2.5 w-2.5 rounded-[3px] border";',
        "a mark that declares itself",
      ],
      ["<p>Rounded corners everywhere</p>;", "the word in copy, which is JSX text and not a class"],
    ],
  },
  {
    /**
     * A label names its control (issue #484, part 6). A `<Field>` points at one control with
     * `htmlFor` or says it labels several with `group`; a raw `<label>` points or wraps. The
     * `good` cases are the four shapes a tied label takes, so a selector that eats one is caught.
     */
    rule: "a label is tied to its control (issue #484)",
    filePath: "app/(admin)/admin/probe/page.tsx",
    bad: [
      ['<Field label="Name"><Input name="n" /></Field>;', "a Field with neither htmlFor nor group"],
      [
        '<Field layout="row" label="Days"><Chip name="d" value="1">Mon</Chip></Field>;',
        "a group not marked as one",
      ],
      [
        '<Field label="Name" hint={<label htmlFor="x">x</label>}><Input name="n" /></Field>;',
        "an htmlFor nested inside an attribute value is not the Field's own",
      ],
      ['<label className="text-sm text-muted">Name</label>;', "a raw label tied to nothing"],
      ['<label className="flex">Total <span>{n}</span></label>;', "a raw label wrapping text, not a control"],
      ['<label x={<Input name="t" />}>Tiers</label>;', "a control inside an attribute value is not wrapped"],
    ],
    good: [
      ['<Field label="Name" htmlFor="n"><Input id="n" name="n" /></Field>;', "a Field pointing at its control"],
      ['<Field label="Days" group><Chip name="d" value="1">Mon</Chip></Field>;', "a Field naming a group"],
      ['<label htmlFor="n" className="text-sm">Name</label>;', "a raw label pointing at its control"],
      ['<label className="flex">Tiers <Input name="t" /></label>;', "a raw label wrapping its control"],
      ['<label>Tiers <span>{on && <Select name="t" />}</span></label>;', "wrapping it a level or two down"],
      ['<label>Day <AutoSubmitDate name="d" value="x" /></label>;', "wrapping a control's wrapper"],
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

/**
 * Same guard, other direction: #951's token ban has to survive the NARROWING blocks.
 *
 * `app/**\/actions.ts` is a subset of `app/**`, so its block rebuilds the selector list
 * from scratch. It spreads the shared constants back in — and the day someone adds a
 * fifth rule to it and forgets one, this is what says so. The `app/**` row is the
 * control: if that one ever fails, the rule is off everywhere and the rest is noise.
 */
describe("the #951 token ban reaches the narrowing blocks too", () => {
  it.each([
    ["app/(admin)/admin/probe/page.tsx", "app/** — the control"],
    ["app/(admin)/admin/probe/actions.ts", "app/**/actions.ts still composes it"],
    ["components/probe.tsx", "components/**"],
  ])("%s — %s", async (filePath) => {
    const found = await violations('const c = "text-faint";', filePath);
    expect(found).not.toHaveLength(0);
  });
});

/**
 * The `components/ui` primitives subtract ONE selector, not the whole rule.
 *
 * They wrap `<button type="submit">` and need exempting from that ban alone. The block
 * used to say `"no-restricted-syntax": "off"`, which quietly also dropped #854's catch
 * ban, the redirect-in-try ban, the clock rule, and then #951's token ban — in the very
 * commit that added it, to the four files most likely to grow a fresh `text-faint`. It
 * was caught by review, not by the gate, because an absent rule and a satisfied rule
 * produce the same silence.
 *
 * So the exemption is now a `.filter()` on one named selector, and this is what says the
 * subtraction is still exactly one wide.
 */
describe("components/ui primitives keep every ban except the raw-submit one", () => {
  const PRIMITIVE = "components/ui/app-link.tsx";

  it.each([
    ['const c = "text-faint";', "#951's token ban"],
    ["try { x(); } catch { }", "#854's bare-catch ban"],
    ["try { redirect('/a'); } catch (e) { log(e); }", "the redirect-in-try ban"],
    ['d.toLocaleDateString("en-US");', "the clock rule"],
  ])("still fires on %s (%s)", async (code) => {
    expect(await violations(code, PRIMITIVE)).not.toHaveLength(0);
  });

  it("stays quiet on the raw submit button — the one thing these files exist to wrap", async () => {
    expect(await violations('<button type="submit">Go</button>;', PRIMITIVE)).toHaveLength(0);
  });

  it("and that exemption is theirs alone — an ordinary component still gets it", async () => {
    const found = await violations('<button type="submit">Go</button>;', "components/probe.tsx");
    expect(found).not.toHaveLength(0);
  });
});

/**
 * The role glyph is the one mark that is a component, so its FILE is exempt from the radius
 * rule (issue #484, part 5) — by the same one-selector subtraction as the primitives above.
 * Pinned from both sides: the exemption reaches nothing else in that file, and no other file.
 */
describe("role-glyph.tsx is exempt from the radius rule and nothing else", () => {
  const GLYPH = "components/ui/role-glyph.tsx";
  const MARK = 'const c = "h-[18px] w-[18px] rounded-[5px]";';

  it("stays quiet on the glyph's own corner", async () => {
    expect(await violations(MARK, GLYPH)).toHaveLength(0);
  });

  it("still fires on #951's token ban there", async () => {
    expect(await violations('const c = "text-faint";', GLYPH)).not.toHaveLength(0);
  });

  it("and the exemption is that file's alone", async () => {
    expect(await violations(MARK, "components/probe.tsx")).not.toHaveLength(0);
  });
});
