/**
 * xlsx reader tests (Task 1.2 / M1; pure-Node rewrite — DEC-037).
 *
 * Two layers:
 *  - A deterministic synthetic .xlsx built in-memory (a minimal DEFLATE zip), so
 *    CI exercises the pure-Node central-directory + inflate path without shipping
 *    a binary fixture or any PII.
 *  - A skip-unless-present smoke test against Eric's real Xola export at
 *    ~/muster-data, so the real-world shape stays covered locally.
 * The import logic itself is covered by import-reservations.test.ts against raw rows.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readXlsxSheet, readXlsxSheetFile } from "./xlsx-extract.js";

/** Build a minimal zip (all entries DEFLATE/method-8) the reader can parse. */
function makeZip(entries: { name: string; data: string }[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const raw = Buffer.from(data, "utf8");
    const comp = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // method DEFLATE
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, comp);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(8, 10); // method DEFLATE
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const cell = (ref: string, text: string) =>
  `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

const SYNTH_XLSX = (): Buffer =>
  makeZip([
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0"?><workbook xmlns:r="x"><sheets><sheet name="Reservations" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: `<worksheet><sheetData><row r="1">${cell("A1", "Reservation ID")}${cell("C1", "Product")}</row><row r="2">${cell("F2", "Name")}${cell("H2", "Total Demographics")}</row></sheetData></worksheet>`,
    },
  ]);

describe("readXlsxSheet (pure-Node, synthetic)", () => {
  it("reads a named sheet, aligning cells by column letter", () => {
    const rows = readXlsxSheet(SYNTH_XLSX(), "Reservations");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Reservation ID");
    expect(rows[0]).toContain("Product");
    expect(rows[0]?.[0]).toBe("Reservation ID"); // A1
    expect(rows[0]?.[2]).toBe("Product"); // C1 → index 2, gap at B filled
    expect(rows[1]).toContain("Name");
    expect(rows[1]).toContain("Total Demographics");
  });

  it("throws on a missing sheet name", () => {
    expect(() => readXlsxSheet(SYNTH_XLSX(), "Nope")).toThrow(/not found/);
  });

  it("throws on bytes that aren't a zip", () => {
    expect(() => readXlsxSheet(Buffer.from("not a zip at all"), "Reservations")).toThrow(
      /not an \.xlsx/i,
    );
  });
});

const REAL = join(homedir(), "muster-data", "reservations.xlsx");

describe.skipIf(!existsSync(REAL))("readXlsxSheetFile (real export)", () => {
  it("extracts the Reservations sheet with its two header rows", () => {
    const rows = readXlsxSheetFile(REAL, "Reservations");
    expect(rows.length).toBeGreaterThan(2);
    expect(rows[0]).toContain("Reservation ID");
    expect(rows[0]).toContain("Product");
    expect(rows[1]).toContain("Name"); // sub-header row
    expect(rows[1]).toContain("Total Demographics");
  });

  it("throws on a missing sheet name", () => {
    expect(() => readXlsxSheetFile(REAL, "Nope")).toThrow(/not found/);
  });
});
