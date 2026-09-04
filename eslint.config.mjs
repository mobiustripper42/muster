import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";
import vitest from "@vitest/eslint-plugin";
import playwright from "eslint-plugin-playwright";
import reactHooks from "eslint-plugin-react-hooks";
import js from "@eslint/js";

/**
 * The `recommended` preset of one plugin, minus the rules listed in `OFF` (#907).
 *
 * **A spread, not 298 hand-written entries, and that is the load-bearing choice.**
 * A hand list is a snapshot: it silently fails to pick up a rule the plugin adds in
 * a later version, and nothing ever reports the omission. The spread stays current,
 * and the exclusions are the thing a person maintains — which is the right way
 * round, because the exclusions are the part with reasons attached.
 *
 * Keeps only rules the plugin actually owns: a preset also carries bare core-rule
 * names it switches OFF, and passing those through under a plugin prefix is a hard
 * config error ("Could not find no-var in plugin @typescript-eslint").
 */
const recommended = (mod) => {
  const cfg =
    mod.configs?.recommended ??
    mod.configs?.["flat/recommended"] ??
    mod.configs?.["recommended-latest"];
  const raw = cfg?.rules ?? (Array.isArray(cfg) ? Object.assign({}, ...cfg.map((c) => c.rules ?? {})) : {});
  const owned = new Set(Object.keys(mod.rules ?? {}));
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([k, v]) => v && v !== "off" && v !== 0)
      .filter(([k]) => k.includes("/") && owned.has(k.split("/").slice(1).join("/")))
      .map(([k]) => [k, "error"]),
  );
};

/**
 * THE CEILING (#907, and DEC-159 rule 5 — state it where the rule is configured).
 *
 * 347 rules across the five `recommended` presets were run against this codebase
 * with each plugin scoped exactly as it is scoped below. **297 returned zero
 * findings and are now ON.** The 50 here are every rule that fired, with its count
 * and the issue that owns it. Nothing is off because it was awkward; everything off
 * has a number.
 *
 * 347 − 50 = 297. Three further entries below are no-ops kept for the reader:
 * `@typescript-eslint/no-unused-vars` is in no preset (the hand-picked block owns
 * it), and base `no-unused-vars` is off for a reason that is not a finding count.
 *
 * **Spreading a preset is DEC-166**, which supersedes DEC-159's "never adopt a
 * plugin's preset" clause. DEC-159's other four rules — invariants only, `error`
 * only, measure first, fix false positives in config — are unchanged and still
 * govern everything here.
 *
 * Deleting a line here turns that rule on. That is the intended workflow: fix the
 * findings, delete the line, and the count in the comment is what tells you how big
 * the job is before you start.
 *
 * **The measurement excluded type-aware rules**, which need `parserOptions.project`.
 * DEC-159 already priced that at +19s on every gate for zero violations, and nothing
 * here changes that verdict.
 *
 * ## What this costs, measured, and why it is not the thing DEC-159 rejected
 *
 * `npm run lint` goes **6.8s → 25.6s** on this machine, both measured back to back on
 * the same tree. That is **+18.8s**, which is within a second of the +19s DEC-159
 * measured for type-aware rules and rejected.
 *
 * The number being the same is a coincidence; the trade is not. DEC-159 was pricing
 * +19s that bought **zero** enforced violations — pure cost. This buys 298 rules that
 * hold from now on, including four security rules (`sql-queries`,
 * `no-clear-text-protocols`, `super-linear-regex`, `no-os-command-from-path`) that had
 * never run against this codebase in any form.
 *
 * Recorded here rather than argued, because the number is what a future reader needs.
 * If the gate ever feels slow, this line is where to start, and `sonarjs` (217 of the
 * 298) is the first thing to profile.
 */
const OFF = {
  // --- playwright (e2e/ only) ---
  "playwright/prefer-locator": "off",               // 105 findings — issue #909
  "playwright/no-force-option": "off",              //  16 findings — issue #908 (already measured 16/16 legitimate in issue #904)
  "playwright/no-conditional-in-test": "off",       //  10 findings — issue #908
  "playwright/no-skipped-test": "off",              //   8 findings — issue #908 (7 legitimate per issue #904; the real one is e2e/trainee-staffing.spec.ts:20)
  "playwright/prefer-web-first-assertions": "off",  //   6 findings — issue #908
  "playwright/expect-expect": "off",                //   2 findings — issue #908 (2/2 legitimate per issue #904 — both assert via page.waitForURL)
  "playwright/no-conditional-expect": "off",        //   2 findings — issue #908
  "playwright/prefer-to-have-count": "off",         //   2 findings — issue #908
  "playwright/no-useless-not": "off",               //   1 finding  — issue #908
  "playwright/no-wait-for-timeout": "off",          //   1 finding  — issue #908 (legitimate per issue #904 — a settle before asserting an absence)

  // --- sonarjs. The four SECURITY rules below have never run on this codebase. ---
  "sonarjs/no-nested-conditional": "off",           //  87 findings — issue #909
  "sonarjs/cognitive-complexity": "off",            //  61 findings — issue #909 (threshold is configurable; measure before choosing one)
  "sonarjs/no-redundant-optional": "off",           //  53 findings — issue #909
  "sonarjs/super-linear-regex": "off",              //  29 findings — issue #908  ← SECURITY
  "sonarjs/prefer-specific-assertions": "off",      //  20 findings — issue #909
  "sonarjs/no-nested-template-literals": "off",     //  16 findings — issue #908
  "sonarjs/void-use": "off",                        //  16 findings — issue #908
  "sonarjs/sql-queries": "off",                     //  14 findings — issue #908  ← SECURITY
  "sonarjs/no-clear-text-protocols": "off",         //  12 findings — issue #908  ← SECURITY (expect http://mill-dev:3000 among them — deliberate)
  "sonarjs/no-unused-vars": "off",                  //  12 findings — issue #908
  "sonarjs/unused-import": "off",                   //   7 findings — issue #908
  "sonarjs/assertions-in-tests": "off",             //   3 findings — issue #908
  "sonarjs/no-duplicated-branches": "off",          //   2 findings — issue #908
  "sonarjs/no-os-command-from-path": "off",         //   2 findings — issue #908  ← SECURITY
  "sonarjs/no-empty-test-file": "off",              //   2 findings — issue #908
  "sonarjs/no-skipped-tests": "off",                //   2 findings — issue #908
  "sonarjs/no-inverted-boolean-check": "off",       //   2 findings — issue #908
  "sonarjs/no-nested-functions": "off",             //   1 finding  — issue #908
  "sonarjs/regex-complexity": "off",                //   1 finding  — issue #908
  "sonarjs/todo-tag": "off",                        //   1 finding  — issue #908
  "sonarjs/concise-regex": "off",                   //   1 finding  — issue #908
  "sonarjs/no-unused-collection": "off",            //   1 finding  — issue #908
  "sonarjs/no-floating-point-equality": "off",      //   1 finding  — issue #908
  "sonarjs/redundant-type-aliases": "off",          //   1 finding  — issue #908
  "sonarjs/no-trivial-assertions": "off",           //   1 finding  — issue #908

  // --- vitest (test files only) ---
  "vitest/no-conditional-expect": "off",            //  21 findings — issue #909
  "vitest/expect-expect": "off",                    //   3 findings — issue #908
  "vitest/no-disabled-tests": "off",                //   2 findings — issue #908
  "vitest/valid-title": "off",                      //   1 finding  — issue #908
  "vitest/valid-expect": "off",                     //   1 finding  — issue #908

  // --- eslint core ---
  // SUPERSEDED, not deferred — the only entry here that is off for a reason other
  // than a finding count. The base rule cannot see TypeScript's type-only usage, so
  // it reports 274 false positives (a type imported and used only in a type
  // position, an `_`-prefixed parameter this repo deliberately keeps). The
  // TS-aware `@typescript-eslint/no-unused-vars` is the real rule and is configured
  // per-scope below. Turning this on would be a regression, not stricter linting.
  "no-unused-vars": "off",                          // 274 false positives — superseded
  "no-undef": "off",                                //  11 findings — issue #908 (the db/xola-report.ts rule; expect DOM-type false positives in e2e/)
  "no-unused-private-class-members": "off",         //   2 findings — issue #908
  "no-redeclare": "off",                            //   1 finding  — issue #908
  "no-useless-escape": "off",                       //   1 finding  — issue #908
  "no-empty": "off",                                //   1 finding  — issue #908
  "no-irregular-whitespace": "off",                 //   1 finding  — issue #908

  // --- @typescript-eslint ---
  // Core `no-unused-vars` is off wherever the TS-aware variant runs (it cannot see
  // type-only usage); the variant itself is configured per-scope further down. This
  // entry is the WIDER application of it, which fires 10.
  "@typescript-eslint/no-unused-vars": "off",       //  10 findings — issue #908

  // --- react-hooks ---
  "react-hooks/set-state-in-effect": "off",         //   4 findings — issue #908
  "react-hooks/refs": "off",                        //   1 finding  — issue #908
  "react-hooks/error-boundaries": "off",            //   1 finding  — issue #908
};

/** Why the core and its scripts may not import a framework package — one message, cited below.
 *  Worded to be true from `db/` as well as `src/`: these rules cover both, and a db script told
 *  "src/ is the domain core" is being given a reason that does not apply to the file it is in. */
const CORE_PURITY =
  "This file is outside the Next app. src/ is the stack-agnostic domain core and stays " +
  "framework-free (DEC-013/DEC-020) so it can outlive this stack behind the Repository port; " +
  "db/ scripts run under tsx on plain Node, where a framework import has nothing to resolve " +
  "against. Framework code belongs in app/ or components/, which import the core via the " +
  "@core/* alias — never the other way round.";

const CORE_PURITY_ALIAS =
  "@core/* is the Next app's alias FOR this directory (root tsconfig paths). Inside src/, import " +
  "by relative path with an explicit .js specifier — tsconfig.core.json is NodeNext and declares " +
  "no path aliases, so this cannot resolve here at all.";

/**
 * ESLint (#250, DEC-090) — deliberately minimal, so it doesn't flood the codebase with
 * style warnings. Uses the typescript-eslint parser to read .ts/.tsx (incl. JSX); no
 * recommended sets.
 *
 * **App + components (#250, DEC-090)** — the two rules that keep the loading-feedback
 * system whole:
 *
 *  1. Ban the raw `next/link` DEFAULT import (`Link`) → use `<AppLink>`, which has
 *     the navigation loading spinner built in. (`useLinkStatus`, a NAMED import,
 *     stays allowed — that's how NavSpinner reads pending.)
 *  2. Flag raw `<button type="submit">` → use `<SubmitButton>` (server-action forms)
 *     or `<GetFormSubmit>` (native GET filter forms), so it shows an in-flight
 *     spinner.
 *
 * Exempt: the wrapper components themselves (they use the raw primitives), and the
 * outbox buttons (which own their optimistic "Sent ✓"/"Copied ✓" feedback, DEC-089)
 * carry an inline eslint-disable with that reason.
 *
 * **src/ and db/ (#757)** — until this, `src/` was linted by NOTHING. Two independent
 * gates excluded it: `"lint": "eslint app components"` passed only those two directories,
 * and the block above matches only `app/**` and `components/**`, so even `eslint .` applied
 * zero rules there. That was a defensible default while the only rules were JSX-shaped and
 * meaningless in a framework-free core — it stopped being defensible once there were rules
 * that pay there.
 *
 * The core-purity ban below is the one that earns its place immediately: `src/` is the
 * stack-agnostic domain core behind the `Repository` port (DEC-013/DEC-020) and must stay
 * framework-free, which is today a convention `@code-review` hunts by reading. `tsconfig.core.json`
 * enforces it only *indirectly* — its `lib` omits `dom` and its `include` is `["src"]`, so a React
 * import happens to fail typechecking for a reason that never mentions the actual rule. This
 * says the rule out loud and fails on the import itself.
 */
export default tseslint.config(
  // ── The measured presets (#907) ────────────────────────────────────────────
  //
  // These blocks come FIRST, deliberately. Flat config is last-wins, and the
  // hand-picked rules below carry options a preset would otherwise clobber —
  // `@typescript-eslint/no-unused-vars` in `src/`/`db/` is configured with an
  // `argsIgnorePattern` and `ignoreRestSiblings` that matter, and `OFF` sets that
  // rule off for the wider application. Put these last and that configuration
  // silently disappears.
  //
  // Each block's scope mirrors the hand-picked block for the same plugin further
  // down. A preset applied wider than the plugin belongs is not a stricter config,
  // it is a noisy one: applying playwright's rules to `src/` produced 4,464 findings
  // in a directory with no Playwright tests, which is how the first measurement of
  // this work went wrong.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "src/**/*.{ts,tsx}", "db/**/*.{ts,tsx}", "scripts/**/*.mjs"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: { ...js.configs.recommended.rules, ...OFF },
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "src/**/*.{ts,tsx}", "db/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { sonarjs },
    rules: { ...recommended(sonarjs), ...OFF },
  },
  {
    files: ["src/**/*.test.ts", "app/**/*.test.ts", "components/**/*.test.ts", "db/**/*.test.ts", "scripts/**/*.test.mjs"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { vitest },
    rules: { ...recommended(vitest), ...OFF },
  },
  {
    files: ["e2e/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    plugins: { playwright },
    rules: { ...recommended(playwright), ...OFF },
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { "react-hooks": reactHooks },
    rules: { ...recommended(reactHooks), ...OFF },
  },
  // ── The hand-picked rules ──────────────────────────────────────────────────
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              importNames: ["default"],
              message:
                "Use <AppLink> (components/ui/app-link) for internal links — it has the loading spinner built in (DEC-090). For tel:/mailto:/external, use a plain <a>.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='type'][value.value='submit']",
          message:
            'Use <SubmitButton> (server-action forms) or <GetFormSubmit> (GET filter forms) instead of a raw <button type="submit"> so it shows an in-flight spinner (DEC-090). For a genuine exception, add an eslint-disable-next-line no-restricted-syntax with a reason.',
        },
        {
          selector: "CatchClause[param=null]",
          message:
            "Bind the error and log it — `catch (e) { logSwallowed('<surface>', e); … }` from app/lib/swallowed (#854). A bare `catch {}` is the only place that knows why something failed, and it discards it: an unapplied migration rendered a calm 'try again in a moment' with an empty server log, and recovering the cause took a throwaway script. For a genuine NON-fault — malformed user input, a clipboard rejection — add an eslint-disable-next-line no-restricted-syntax saying which.",
        },
        // READ THE CEILING of the catch ban above (DEC-159 rule 5). This block is
        // `app/**` + `components/**`, so the ban stops at the framework boundary.
        // **23 bare catches remain in `src/` and `db/` and are NOT covered** — three of
        // them on the money path: `src/reservations/booking-webhook.ts:461,546,605`,
        // the confirmation send, the sold-out notify, and the Stripe receipt URL.
        //
        // That gap is structural rather than an oversight. `src/` is the framework-free
        // core (DEC-013/DEC-020) and cannot import `app/lib/swallowed.ts` — the
        // core-purity ban further down enforces exactly that — so closing it needs a
        // core-local logger or a decision to leave it. Filed as issue #902.
        //
        // Do not read "we fixed the bare catches" as covering the core. It does not,
        // and an undocumented blind spot gets trusted for things it never checked
        // (DEC-144).
      ],
    },
  },
  {
    // The wrappers legitimately use the raw primitives they encapsulate.
    //
    // `no-restricted-syntax: "off"` is now BLUNTER than it reads. Since #854 that key
    // carries two selectors — the raw-submit-button ban these files need exempting from,
    // and the bare-`catch {}` ban they do not. Switching it off drops both. All five
    // files below contain zero `catch` today (verified), so the hole is empty; if one
    // ever grows a swallowed error it will pass lint in silence. Narrow this to per-line
    // disables if that day comes.
    files: [
      "components/ui/app-link.tsx",
      "components/ui/nav-spinner.tsx",
      "components/ui/submit-button.tsx",
      "components/ui/get-form-submit.tsx",
    ],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    // Outbox cards (Send / Dismiss / In-Out relay) own their OWN optimistic
    // feedback — "Sent ✓" / "Copied ✓" via the RelaySend / CopyButton islands
    // (DEC-089 exclusion). They deliberately don't use <SubmitButton>.
    // Same bluntness caveat as the block above: this also switches off the #854
    // bare-catch ban for this file, which has no `catch` today.
    files: ["components/outbox/outbox-card.tsx"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // The framework-free domain core, and the scripts that drive it (#757).
    //
    // The glob is `.ts` and `.tsx` on purpose. `.ts` alone would be the natural spelling — there
    // are no `.tsx` files in `src/` and by construction there never should be — but it would mean
    // the one file that most flagrantly breaks core purity is the one file the ban does not
    // match. Covering `.tsx` here makes the ban catch it; the parser has no `ecmaFeatures.jsx`,
    // so such a file also fails to parse. Belt and braces, and neither is load-bearing alone.
    files: ["src/**/*.{ts,tsx}", "db/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: CORE_PURITY },
            { name: "react-dom", message: CORE_PURITY },
            { name: "next", message: CORE_PURITY },
            { name: "server-only", message: CORE_PURITY },
            { name: "client-only", message: CORE_PURITY },
          ],
          patterns: [
            { group: ["next/*", "react/*", "react-dom/*"], message: CORE_PURITY },
            // `@core/*` is the NEXT APP's alias for this very directory (root tsconfig
            // `paths`). Inside the core it would be the core reaching for itself through
            // the framework's resolver — which `tsconfig.core.json` (NodeNext, no `paths`)
            // cannot resolve at all. Relative `.js` specifiers are the only correct form.
            { group: ["@core/*"], message: CORE_PURITY_ALIAS },
          ],
        },
      ],
      // tsc leaves this one: neither profile sets `noUnusedLocals`/`noUnusedParameters`.
      // `argsIgnorePattern` matches the existing convention of `_`-prefixing a deliberately
      // unused parameter (a port method that must match a signature it doesn't need).
      //
      // `ignoreRestSiblings` is NOT cosmetic. `const { vesselId, ...rest } = record` names a
      // property solely to OMIT it from `rest` — the binding is unused by design and deleting
      // it changes what `rest` contains. Without this the rule reports a legitimate idiom as
      // dead code, which is the shape of false positive that gets a whole rule switched off.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Within-file duplicate implementations (#757).
    //
    // **Read the ceiling before trusting this rule.** It is PER-FILE — verified empirically,
    // not assumed: two byte-identical functions in two different files produce no finding at
    // all; the same two in one file are flagged. So it would NOT have caught the duplication
    // that motivated #757 (the minutes→hours rule spelled four times in three shapes, DEC-157),
    // because those copies lived in separate files. The original note here claimed it would
    // have. That was wrong.
    //
    // It is kept because it found 3 real within-file duplicates on its first run and costs
    // nothing to keep. It is NOT the answer to cross-file duplication, and nothing in this
    // config is. That needs a token-level cross-file detector (jscpd or equivalent) for the
    // twins, and the repo-wide "one rule, many spellings" audit parked in docs/FUTURE_IDEAS.md
    // for the synonyms — which is the harder and more common half.
    files: [
      "src/**/*.{ts,tsx}",
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "db/**/*.{ts,tsx}",
    ],
    plugins: { sonarjs },
    rules: { "sonarjs/no-identical-functions": "error" },
  },
  {
    // A stray `.only` silently reduces a suite to one test and CI goes green — the exact shape
    // of "green means nothing" this project has already been bitten by twice (a footer total
    // asserted with `getByText("$499.00").first()` that matched a slot row, and a `calendar.spec`
    // literal that was right only by coincidence of a one-boat fixture). Both were green the
    // whole time. Currently zero occurrences, so this is pure prevention, not cleanup.
    // The glob MUST track `vitest.config.ts`'s `include`, or the rule guards a subset of the
    // suite while reading as though it guards all of it. It first shipped as `src/**/*.test.ts`
    // alone, which left `app/`, `components/`, `db/` and the `scripts/` tests — 10 files — able
    // to go green on a stray `.only`. A guard whose blind spot is undocumented gets trusted for
    // things it never checked (DEC-144).
    files: [
      "src/**/*.test.ts",
      "app/**/*.test.ts",
      "components/**/*.test.ts",
      "db/**/*.test.ts",
      "scripts/**/*.test.mjs",
    ],
    plugins: { vitest },
    rules: { "vitest/no-focused-tests": "error" },
  },
  {
    // `**/*.ts`, not `**/*.spec.ts`: `fixtures.ts` is imported by every spec, and a config that
    // covers only the spec filename shape reads as "e2e is linted" while leaving the shared
    // harness untouched. `no-focused-test` only fires on specs; the rest of the block is what
    // makes the widened `lint` script honest.
    files: ["e2e/**/*.ts"],
    plugins: { playwright },
    languageOptions: { parser: tseslint.parser },
    rules: { "playwright/no-focused-test": "error" },
  },
  {
    // The Rules of Hooks, across the `"use client"` islands (#757). A hook called
    // conditionally or inside a loop corrupts React's per-render hook ordering, and this
    // project has no React unit-test layer to catch it — the islands are covered, if at all,
    // by e2e, which sees a symptom rather than the cause.
    //
    // **This was the only react-hooks rule until #907, and the reason has now expired.**
    // It used to read: "`recommended` would drag them all in unmeasured, which is precisely
    // what DEC-159 rule 1 forbids." That was right at the time and is no longer true —
    // `recommended` has since been measured (16 rules, 3 firing, see `OFF`) and is spread in
    // above. This entry stays because `rules-of-hooks` is load-bearing enough to survive a
    // future preset change on its own.
    //
    // **`exhaustive-deps` is now ON**, at `error`, with zero findings — swept in by the
    // preset above rather than admitted by name. This block used to say it was
    // "deliberately NOT here"; that stopped being true in the same commit that widened
    // the preset, and the stale sentence was caught in review rather than by a reader
    // trusting it.
    //
    // It satisfies DEC-159 rather than dodging it. What #757 rejected was a proposal to
    // run it at `warn` — and `lint` carries no `--max-warnings 0`, so a warn-level rule
    // cannot fail this gate: it prints advice into output nobody reads while implying
    // enforcement (rule 2). At `error` and at zero it is prevention on rule 1's terms,
    // and the warn-tier ban is untouched. Nobody had to read a backlog of findings
    // because there is no backlog.
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error" },
  },
);
