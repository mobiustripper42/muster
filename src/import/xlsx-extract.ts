/**
 * xlsx → rows (the disposable Xola reader — DEC-015).
 *
 * Xola only exports xlsx, so the import adapter reads it directly rather than
 * forcing a manual xlsx→CSV step. An .xlsx is a zip of XML. This reads the zip
 * **in memory with pure Node** — a minimal central-directory parse +
 * `zlib.inflateRaw` — and scans the sheet XML with light regex parsing.
 *
 * Why not shell out to `unzip` (the M1 implementation): the system `unzip` binary
 * is absent on Vercel's serverless Node runtime, so an upload that's green locally
 * would ENOENT in production — the exact failure during the crew test (DEC-037).
 * Pure Node has no binary dependency and no new npm dependency (zlib is built in),
 * and it takes a Buffer so the uploaded file parses in memory, no temp file.
 *
 * It deliberately does NOT evaluate formulas/macros — it only reads cell text and
 * shared strings (no calc chain, no VBA). Keep it that way; don't "upgrade" to a
 * full xlsx library here without re-reviewing the upload-security posture (DEC-037).
 *
 * Output is `string[][]` — raw cell text, columns aligned by letter (gaps filled).
 * Header interpretation and field selection happen downstream (Map).
 */

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const decode = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

// --- minimal ZIP reader (central-directory + inflateRaw) --------------------

const SIG_EOCD = 0x06054b50; // end of central directory
const SIG_CEN = 0x02014b50; // central directory file header
const SIG_LOC = 0x04034b50; // local file header

/**
 * Per-entry decompressed cap — the zip-bomb guard. A reservations sheet is well
 * under this; `inflateRaw` aborts past it rather than ballooning memory.
 */
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

interface ZipEntry {
  method: number;
  compressedSize: number;
  localOffset: number;
}

/** Index a zip's central directory: entry name → header location. */
function indexZip(buf: Buffer): Map<string, ZipEntry> {
  // Scan backward for the EOCD signature (it sits before an optional comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not an .xlsx (no zip end-of-central-directory)");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central directory offset
  const map = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN) {
      throw new Error("corrupt zip central directory (zip64 is unsupported)");
    }
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const fnLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + fnLen);
    map.set(name, { method, compressedSize, localOffset });
    p += 46 + fnLen + extraLen + commentLen;
  }
  return map;
}

/** Read + decompress one entry as UTF-8 text (stored or DEFLATE only). */
function readEntry(buf: Buffer, e: ZipEntry, name: string): string {
  if (buf.readUInt32LE(e.localOffset) !== SIG_LOC) {
    throw new Error(`corrupt zip local header for ${name}`);
  }
  // The local header's own filename/extra lengths locate the data (they can
  // differ from the central directory's extra length).
  const fnLen = buf.readUInt16LE(e.localOffset + 26);
  const extraLen = buf.readUInt16LE(e.localOffset + 28);
  const start = e.localOffset + 30 + fnLen + extraLen;
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) {
    if (data.length > MAX_ENTRY_BYTES) {
      throw new Error(`zip entry ${name} exceeds the size cap`);
    }
    return data.toString("utf8");
  }
  if (e.method === 8) {
    return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }).toString("utf8");
  }
  throw new Error(`unsupported zip compression (method ${e.method}) for ${name}`);
}

// --- xlsx parsing -----------------------------------------------------------

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
 * Read a named sheet from an .xlsx **buffer** as raw rows. Throws if the bytes
 * aren't a zip or the sheet name isn't found (a dirty/renamed export surfaces
 * loudly, not silently empty). Buffer-in (not a path) so an uploaded file parses
 * in memory — no temp file, serverless-safe.
 */
export function readXlsxSheet(source: Buffer, sheetName: string): string[][] {
  const zip = indexZip(source);
  const entry = (name: string): string => {
    const e = zip.get(name.replace(/^\/+/, ""));
    if (!e) throw new Error(`zip entry not found: ${name}`);
    return readEntry(source, e, name);
  };

  const workbook = entry("xl/workbook.xml");
  // Match both <sheet .../> and <sheet ...></sheet> (writer-style independent);
  // \b keeps it from matching the <sheets> container.
  const sheetTag = [...workbook.matchAll(/<sheet\b[^>]*>/g)]
    .map((m) => m[0])
    .find((tag) => tag.includes(`name="${sheetName}"`));
  if (!sheetTag) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  const rid = sheetTag.match(/r:id="([^"]+)"/)?.[1];
  const rels = entry("xl/_rels/workbook.xml.rels");
  const target = rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1];
  if (!target) throw new Error(`Could not resolve sheet target for ${sheetName}`);

  const shared = zip.has("xl/sharedStrings.xml")
    ? parseSharedStrings(entry("xl/sharedStrings.xml"))
    : []; // a workbook with only inline strings has no sharedStrings.xml — fine.
  const sheetXml = entry(`xl/${target.replace(/^\//, "")}`);
  return parseSheet(sheetXml, shared);
}

/** Convenience: read a sheet straight off a file path (dev tooling / tests). */
export function readXlsxSheetFile(filePath: string, sheetName: string): string[][] {
  return readXlsxSheet(readFileSync(filePath), sheetName);
}
