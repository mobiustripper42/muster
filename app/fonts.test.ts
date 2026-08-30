/**
 * The app must not fetch its typeface from a third party at build time (#731).
 *
 * `next/font/google` reads as a runtime concern and is not one. It downloads the `.woff2` files
 * from `fonts.gstatic.com` **during `next build`**, then self-hosts what it downloaded — so the
 * browser never makes an external request and the network tab looks clean whether or not this is
 * fixed. The dependency is invisible from every direction except a failing build.
 *
 * It has already taken one down: PR #727, run 31449032034 — five font URLs retried three times
 * each, then `NextFontError: Failed to fetch 'IBM Plex Sans' from Google Fonts` → `Build failed
 * because of webpack errors`. Nothing in that diff was at fault. The same branch was green two
 * hours earlier, `main` was green, and `npm run verify` passed locally on the identical commit; a
 * bare re-run cleared it. That is the shape that teaches you to re-run first and read second, and
 * Vercel's production build carries the same dependency.
 *
 * **This is a source-level assertion on purpose.** The property is "no outbound request during the
 * build", and the only way to observe that directly is to build with the network down — which no
 * test in this suite can arrange. What a test *can* do is pin the single import that causes it, so
 * the next person who reaches for `next/font/google` is told why not at the point of writing it
 * rather than by a red build on an unrelated PR six weeks later.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["app", "components"];
// Tests excluded, or this file matches itself — it has to name the forbidden import to explain it.
const SOURCE = /(?<!\.test)\.(ts|tsx)$/;
/** Styling too, for the weight-usage scan — a raw `font-weight:` lives in CSS, not TSX. */
const STYLED = /(?<!\.test)\.(ts|tsx|css)$/;

/** Tailwind's font-weight utilities → the numeric weight each one asks the browser for. */
const TAILWIND_WEIGHTS: Record<string, string> = {
  thin: "100",
  extralight: "200",
  light: "300",
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
  black: "900",
};

/** Every source file under the given roots, recursively. */
function sourceFiles(dir: string, match: RegExp = SOURCE): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path, match));
    else if (match.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * Source with comments removed.
 *
 * Both scans below read raw file text, and the first thing that broke them was the prose written
 * to explain them: a comment saying "a `font-light` with no 300 vendored renders wrong" IS the
 * string `font-light`, and a comment naming the forbidden import IS that import as far as a
 * substring is concerned. A rule that cannot be described in the file it governs is a rule people
 * stop describing.
 *
 * Block comments and whole-line `//` comments only. A trailing `//` after code is left alone
 * deliberately — stripping it means finding where a line's code ends, and `https://` inside a
 * string is exactly the case that gets that wrong.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The weights `layout.tsx` actually vendors — the one declaration both directions read. */
function loadedWeights(): Set<string> {
  const layout = readFileSync(join("app", "layout.tsx"), "utf8");
  return new Set([...layout.matchAll(/weight:\s*"(\d{3})"/g)].map((m) => m[1]!));
}

describe("typeface loading (#731)", () => {
  it("no source file imports next/font/google", () => {
    // Matched as an import statement rather than a bare substring: this rule has to be nameable in
    // the prose that explains it, and `withoutComments` is the other half of that.
    const offenders = ROOTS.flatMap((r) => sourceFiles(r)).filter((f) =>
      /from\s+["']next\/font\/google["']/.test(withoutComments(readFileSync(f, "utf8"))),
    );
    expect(offenders).toEqual([]);
  });

  it("every weight the layout declares has a real woff2 vendored for it", () => {
    // **Derived from `layout.tsx`, never listed here.** A hardcoded list would pass forever while
    // someone adds a fifth weight and vendors nothing for it — and that failure is silent, because
    // a browser synthesizes a missing weight from the nearest face instead of refusing. Reading
    // the declaration is what makes "add a weight" and "add the file" one step rather than two.
    const layout = readFileSync(join("app", "layout.tsx"), "utf8");
    const declared = [...layout.matchAll(/ibm-plex-(sans|mono)-(\d{3})\.woff2/g)];
    expect(declared.length).toBeGreaterThan(0);

    for (const [file] of declared) {
      const bytes = readFileSync(join("app", "fonts", file));
      // The signature, not just the size. The realistic failure is not a zero-byte file — it is a
      // CDN answering 200 with an HTML error page, or a truncated download, either of which is a
      // plausible size and builds without complaint. `wOF2` is the WOFF2 magic number; anything
      // else means the bytes are not a font however many of them arrived.
      expect(bytes.subarray(0, 4).toString("latin1"), `${file} is not a WOFF2 file`).toBe("wOF2");
      expect(bytes.byteLength, `${file} is implausibly small`).toBeGreaterThan(5_000);
    }
  });

  it("no styling asks for a weight that isn't vendored", () => {
    // **The failure this exists for is silent.** A browser handed `font-weight: 300` with no 300
    // face does not refuse — it synthesizes one from the nearest weight it has. The text renders,
    // slightly wrong, and nothing anywhere reports it. Under `next/font/google` the same gap
    // existed; vendoring makes the loaded set explicit, so it can be checked.
    //
    // Checked against the UNION of both families, not per-family. Mono carries no 700, so a
    // `font-bold` inside a `font-mono` element is already synthesized today — but telling that
    // apart needs to know which family an element inherits, which a text scan cannot do. Asserting
    // the union is the honest limit: it catches a weight nobody loaded at all, and says nothing
    // about a weight loaded for the other family.
    const loaded = loadedWeights();
    const used = new Map<string, string>(); // weight → first file that asks for it

    for (const file of ROOTS.flatMap((r) => sourceFiles(r, STYLED))) {
      const text = withoutComments(readFileSync(file, "utf8"));
      // `\b…\b` around the named group is what keeps `font-mono` and `font-sans` — families, not
      // weights — from matching. An arbitrary value (`font-[550]`) is the bypass that would
      // otherwise walk straight past a rule written only against the named utilities.
      //
      // **What it does not see**, found by code review and listed so the next gap is a known one
      // rather than a surprise: a class built by template literal (`` `font-${w}` ``), the CSS
      // shorthand (`font: 700 14px …`), the keyword spellings (`font-weight: bold`), and
      // `font-[var(--x)]`. None appears in `app/` or `components/` today. A scan of source text
      // cannot follow a value that is computed, so these are the shapes to check by eye when one
      // does land.
      for (const m of text.matchAll(
        /\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b|\bfont-\[(\d{3})\]|font-weight:\s*(\d{3})|fontWeight:\s*"?(\d{3})"?/g,
      )) {
        // `fontWeight` is the React inline-style spelling — the same declaration in the casing a
        // CSS-property scan walks straight past, and the likeliest of the gaps above to be written
        // by someone who has never read this test.
        const weight = m[1] ? TAILWIND_WEIGHTS[m[1]]! : (m[2] ?? m[3] ?? m[4])!;
        if (!used.has(weight)) used.set(weight, file);
      }
    }

    expect(used.size).toBeGreaterThan(0);
    const missing = [...used].filter(([w]) => !loaded.has(w));
    expect(
      missing,
      `weights used with no vendored face: ${missing.map(([w, f]) => `${w} (${f})`).join(", ")}`,
    ).toEqual([]);
  });

  it("the layout loads IBM Plex from vendored files via next/font/local", () => {
    // Paired with the assertion above on purpose. "No Google import" is satisfiable by deleting
    // the fonts entirely, which would pass a check written only in the negative and silently drop
    // the mockups' faces back to a system stack.
    const layout = readFileSync(join("app", "layout.tsx"), "utf8");
    expect(layout).toContain("next/font/local");
    expect(layout).toContain("--font-plex-sans");
    expect(layout).toContain("--font-plex-mono");
  });
});
