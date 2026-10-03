import { encode } from "uqr";

/**
 * The trip QR as one SVG path (Phase 18.5b, DEC-191). Pure, so it is unit-tested; `trip-qr.tsx`
 * draws it on the server.
 *
 * Each row's run of dark modules is one rectangle (`M x y h w v1 h-w z`), so the path stays small —
 * the check-in page re-reads itself on a timer and the code comes with every read. Error
 * correction "M" survives a scuffed phone screen at the rail; four modules of margin is the quiet
 * zone the QR standard asks for, and scanners miss codes without it.
 */

export const QR_MARGIN = 4;

export function qrPath(text: string): { size: number; d: string } {
  const { data, size } = encode(text, { ecc: "M", border: QR_MARGIN });
  let d = "";
  data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      d += `M${start} ${y}h${x - start}v1h-${x - start}z`;
    }
  });
  return { size, d };
}
