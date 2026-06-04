/**
 * xlsx → rows (the disposable Xola reader — DEC-015).
 *
 * Xola only exports xlsx, so the import adapter reads it directly rather than
 * forcing a manual xlsx→CSV step (DEC-011's "CSV bridge" was format-shorthand;
 * see the DEC-015 note). An .xlsx is a zip of XML — we shell out to the system
 * `unzip` (no npm dependency in this dep-minimal phase, DEC-013) and scan the
 * sheet XML with light regex parsing. This is the only throwaway piece; it gets
 * a real xlsx library when the stack lands (M4).
 *
 * Output is `string[][]` — raw cell text, columns aligned by letter (gaps
 * filled). Header interpretation and field selection happen downstream (Map).
 */

import { execFileSync } from "node:child_process";

const decode = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Read one entry out of the zip as UTF-8 text (`unzip -p`). */
function unzipEntry(file: string, entry: string): string {
  return execFileSync("unzip", ["-p", file, entry], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Spreadsheet column letters → 0-based index. A→0, Z→25, AA→26. */
function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Parse `sharedStrings.xml` into an index→text table. */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let text = "";
    for (const t of (si[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) {
      text += t[1] ?? "";
    }
    out.push(decode(text));
  }
  return out;
}

/** Parse a worksheet's `<sheetData>` into aligned rows of raw cell text. */
function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cm of (rm[1] ?? "").matchAll(
      /<c r="([A-Z]+)\d+"(?:[^>]*?\st="([^"]+)")?[^>]*?>(?:<v>([\s\S]*?)<\/v>|<is><t[^>]*>([\s\S]*?)<\/t><\/is>)?<\/c>/g,
    )) {
      const col = cm[1];
      const type = cm[2];
      const v = cm[3];
      const inline = cm[4];
      if (!col) continue;
      let value = "";
      if (inline != null) value = decode(inline);
      else if (v != null) value = type === "s" ? (shared[+v] ?? "") : v;
      cells[colToIndex(col)] = value;
    }
    // Fill gaps so every row is index-aligned by column.
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
    rows.push(cells);
  }
  return rows;
}

/**
 * Read a named sheet from an .xlsx file as raw rows. Throws if the sheet name
 * isn't found (a dirty/renamed export surfaces loudly, not silently empty).
 */
export function readXlsxSheet(filePath: string, sheetName: string): string[][] {
  const workbook = unzipEntry(filePath, "xl/workbook.xml");
  const sheetTag = [...workbook.matchAll(/<sheet [^>]*\/>/g)]
    .map((m) => m[0])
    .find((tag) => tag.includes(`name="${sheetName}"`));
  if (!sheetTag) {
    throw new Error(`Sheet "${sheetName}" not found in ${filePath}`);
  }
  const rid = sheetTag.match(/r:id="([^"]+)"/)?.[1];
  const rels = unzipEntry(filePath, "xl/_rels/workbook.xml.rels");
  const target = rels
    .match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1];
  if (!target) throw new Error(`Could not resolve sheet target for ${sheetName}`);

  let shared: string[] = [];
  try {
    shared = parseSharedStrings(unzipEntry(filePath, "xl/sharedStrings.xml"));
  } catch {
    // A workbook with only inline strings has no sharedStrings.xml — fine.
  }
  const sheetXml = unzipEntry(filePath, `xl/${target.replace(/^\//, "")}`);
  return parseSheet(sheetXml, shared);
}
