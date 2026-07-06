/**
 * Generate the PWA / favicon icon set from a single vector Muster mark — a white
 * "M" on the brand navy (#2f5d86, app/globals.css --color-accent). Run once when
 * the mark changes; the PNGs it writes to public/ are committed (add-to-home-screen
 * needs real raster icons, and the manifest references stable URLs).
 *
 *   node scripts/gen-icons.mjs
 *
 * The "M" is drawn as a stroked path (not <text>) so it rasterizes without any
 * font dependency. Two backgrounds: a rounded tile for the favicon/app icon, and
 * a full-bleed square for the Android `maskable` slot (the platform applies its
 * own mask, and the glyph sits inside the ~80% safe zone).
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const NAVY = "#2f5d86";
const M = `<path d="M128 388 V158 L256 300 L384 158 V388" fill="none" stroke="#ffffff"
  stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/>`;

const rounded = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="${NAVY}"/>${M}</svg>`;

const maskable = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${NAVY}"/>${M}</svg>`;

await mkdir("public", { recursive: true });

const jobs = [
  ["public/icon-192.png", rounded, 192],
  ["public/icon-512.png", rounded, 512],
  ["public/icon-512-maskable.png", maskable, 512],
  ["public/apple-touch-icon.png", maskable, 180], // iOS masks corners itself; no alpha
  ["public/favicon-32.png", rounded, 32],
];

for (const [path, svg, size] of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path);
  console.log("wrote", path);
}

// A crisp SVG favicon too (source of truth for the mark).
await import("node:fs/promises").then(({ writeFile }) =>
  writeFile("public/icon.svg", rounded),
);
console.log("wrote public/icon.svg");
