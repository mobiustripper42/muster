import tseslint from "typescript-eslint";

/**
 * ESLint (#250, DEC-090) — the FIRST linting in this project. Deliberately minimal:
 * just the two enforcement rules that keep the loading-feedback system whole, so it
 * doesn't flood a never-linted codebase with style warnings. Uses the
 * typescript-eslint parser to read .ts/.tsx (incl. JSX); no plugins, no recommended
 * sets (those can be layered on later, deliberately).
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
);
