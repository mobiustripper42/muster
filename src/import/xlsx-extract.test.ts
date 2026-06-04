/**
 * xlsx reader smoke test (Task 1.2 / M1).
 *
 * Runs against the real Xola export if it's present at ~/muster-data (Eric's
 * machine) and skips otherwise — so CI stays green without committing PII, while
 * the shell-out + shared-string parse path is exercised against reality locally.
 * The import logic itself is covered by import-reservations.test.ts against raw
 * rows, independent of xlsx parsing.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readXlsxSheet } from "./xlsx-extract.js";

const REAL = join(homedir(), "muster-data", "reservations.xlsx");

describe.skipIf(!existsSync(REAL))("readXlsxSheet (real export)", () => {
  it("extracts the Reservations sheet with its two header rows", () => {
    const rows = readXlsxSheet(REAL, "Reservations");
    expect(rows.length).toBeGreaterThan(2);
    expect(rows[0]).toContain("Reservation ID");
    expect(rows[0]).toContain("Product");
    expect(rows[1]).toContain("Name"); // sub-header row
    expect(rows[1]).toContain("Total Demographics");
  });

  it("throws on a missing sheet name", () => {
    expect(() => readXlsxSheet(REAL, "Nope")).toThrow(/not found/);
  });
});
