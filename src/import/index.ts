/**
 * Xola import barrel — the disposable M1 reader (DEC-011/DEC-015).
 *
 * Convenience: read the Reservations sheet from an .xlsx and import it in one
 * call. The pieces are also exported individually for testing against raw rows.
 */

import type { Repository } from "../ports/repository.js";
import { importReservations, type ImportResult } from "./import-reservations.js";
import { readXlsxSheet } from "./xlsx-extract.js";

export * from "./xlsx-extract.js";
export * from "./product-map.js";
export * from "./import-reservations.js";
export * from "./browse.js";

/** Read the `Reservations` sheet from a Xola .xlsx and import it. */
export async function importXlsx(
  repo: Repository,
  filePath: string,
  sheetName = "Reservations",
): Promise<ImportResult> {
  const rows = readXlsxSheet(filePath, sheetName);
  return importReservations(repo, rows);
}
