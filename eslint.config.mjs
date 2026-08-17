import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";
import vitest from "@vitest/eslint-plugin";
import playwright from "eslint-plugin-playwright";

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
      ],
    },
  },
  {
    // The wrappers legitimately use the raw primitives they encapsulate.
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
);
