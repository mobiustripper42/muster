/**
 * The trip QR's drawing (Phase 18.5b, DEC-191): one SVG path from uqr's module grid. The path joins
 * each run of dark modules in a row into one rectangle so the SVG stays small — it is re-sent on
 * every re-read of the check-in page. What matters is that it draws exactly the modules uqr says
 * are dark, no more and no fewer, with the quiet margin a scanner needs.
 */
import { describe, expect, it } from "vitest";
import { encode } from "uqr";
import { QR_MARGIN, qrPath } from "./qr-path";

/** Every cell the path paints, read back from its `M x y h w v 1 h -w z` runs. */
function painted(d: string): Set<string> {
  const cells = new Set<string>();
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let i = 0; i < w; i++) cells.add(`${x + i},${y}`);
  }
  return cells;
}

describe("qrPath — the trip QR as one SVG path", () => {
  const url = "https://muster.example.com/w/K3F9QZ2M";

  it("paints exactly the dark modules of the code, and nothing else", () => {
    const { d } = qrPath(url);
    const { data } = encode(url, { ecc: "M", border: QR_MARGIN });
    const dark = new Set<string>();
    data.forEach((row, y) => row.forEach((on, x) => on && dark.add(`${x},${y}`)));
    expect(painted(d)).toEqual(dark);
    expect(dark.size).toBeGreaterThan(0);
  });

  it("leaves a quiet margin of four modules on every side", () => {
    const { d, size } = qrPath(url);
    for (const cell of painted(d)) {
      const [x, y] = cell.split(",").map(Number) as [number, number];
      expect(x).toBeGreaterThanOrEqual(QR_MARGIN);
      expect(y).toBeGreaterThanOrEqual(QR_MARGIN);
      expect(x).toBeLessThan(size - QR_MARGIN);
      expect(y).toBeLessThan(size - QR_MARGIN);
    }
  });

  it("joins a row's dark run into one rectangle, so the path stays small", () => {
    const { d } = qrPath(url);
    const runs = d.match(/M/g)?.length ?? 0;
    expect(runs).toBeLessThan(painted(d).size);
  });
});
