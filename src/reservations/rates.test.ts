/**
 * `rates.ts` is a leaf (issue #1266 AC5): `taxCentsFor` and `feeCentsFor` live there, `discount.ts`
 * reads them from it, and `payment-config.ts` only re-exports them — so `discount.ts` and
 * `payment-config.ts` no longer import each other.
 *
 * It reads source rather than behaviour, as `src/builder/form-shifts-notify.test.ts` does, because
 * the cycle it guards works at runtime until a later top-level use hits a load-order error: no
 * behaviour test can see it. The identity check is behaviour, and is what fails a copy of the math
 * left behind in either file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as config from "./payment-config.js";
import * as rates from "./rates.js";

const source = (name: string) => readFileSync(join(process.cwd(), "src/reservations", name), "utf8");

/** Each `import` and re-export (`export {`, `export *`, `export type {`) statement, joined onto one
 *  line, from its keyword to its `;`. A line inside a comment does not start with the keyword, so a
 *  comment naming a path is not a statement. */
function statementsOf(src: string): string[] {
  const out: string[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i]!.trim();
    if (!/^(import\b|export\s*[*{]|export\s+type\s*\{)/.test(head)) continue;
    let stmt = head;
    while (!stmt.includes(";") && i + 1 < lines.length) stmt += ` ${lines[++i]!.trim()}`;
    out.push(stmt);
  }
  return out;
}

/** The quoted module a statement names: after `from`, or straight after a bare `import`. */
function specifierOf(stmt: string): string | undefined {
  const at = stmt.lastIndexOf(" from ") >= 0 ? stmt.lastIndexOf(" from ") + 6 : stmt.indexOf("import") + 6;
  return /^\s*["']([^"']+)["']/.exec(stmt.slice(at))?.[1];
}

/** Every module a file imports or re-exports from, statically or dynamically. */
function specifiersOf(src: string): string[] {
  const out = statementsOf(src).flatMap((s) => specifierOf(s) ?? []);
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']/g)) out.push(m[1]!);
  return out;
}

/** The value names a file imports from `specifier` with `import { … } from` — type-only imports
 *  and `type` members excluded, an alias read by its imported name. */
function namedValueImports(src: string, specifier: string): string[] {
  const names: string[] = [];
  for (const stmt of statementsOf(src)) {
    if (!stmt.startsWith("import") || stmt.startsWith("import type") || specifierOf(stmt) !== specifier) continue;
    const open = stmt.indexOf("{");
    const close = stmt.indexOf("}");
    if (open < 0 || close < open) continue;
    for (const part of stmt.slice(open + 1, close).split(",")) {
      const item = part.trim();
      if (!item || item.startsWith("type ")) continue;
      names.push(item.split(" as ")[0]!.trim());
    }
  }
  return names;
}

const isPaymentConfig = (s: string) => /^\.\/payment-config(\.js)?$/.test(s);
const isDiscount = (s: string) => /^\.\/discount(\.js)?$/.test(s);

describe("rates.ts ends the payment-config ↔ discount import cycle (issue #1266)", () => {
  it("AC5: discount.ts imports nothing from ./payment-config.js", () => {
    expect(specifiersOf(source("discount.ts")).filter(isPaymentConfig)).toEqual([]);
  });

  it("AC5: rates.ts imports nothing from ./payment-config.js or ./discount.js", () => {
    expect(specifiersOf(source("rates.ts")).filter((s) => isPaymentConfig(s) || isDiscount(s))).toEqual([]);
  });

  it("AC5: discount.ts imports taxCentsFor and feeCentsFor from ./rates.js", () => {
    expect(namedValueImports(source("discount.ts"), "./rates.js")).toEqual(
      expect.arrayContaining(["taxCentsFor", "feeCentsFor"]),
    );
  });

  it("AC5: payment-config.js's taxCentsFor and feeCentsFor are the functions rates.js exports — re-exported, not copied", () => {
    expect(config.taxCentsFor).toBe(rates.taxCentsFor);
    expect(config.feeCentsFor).toBe(rates.feeCentsFor);
  });
});
