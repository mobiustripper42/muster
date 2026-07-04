/**
 * Vessel identity hue (DEC-086) — which `--color-vessel-N` token a vessel's
 * board dot renders in. The real fleet is PINNED (chosen, not auto-generated —
 * the DEC's guardrail); anything unpinned (dev seeds, a future 5th boat before
 * someone pins it) falls back to a stable hash over the remaining pool, so a
 * given vessel id always lands on the same hue within and across renders.
 *
 * Identity only, never state — the dot answers "which boat," nothing else.
 */

/** Literal class strings so Tailwind's scanner sees them. */
const HUES = [
  "bg-vessel-1",
  "bg-vessel-2",
  "bg-vessel-3",
  "bg-vessel-4",
  "bg-vessel-5",
  "bg-vessel-6",
] as const;

/** The chosen assignment for the real fleet (src/import/resource-map.ts). */
const PINNED: Record<string, (typeof HUES)[number]> = {
  "vessel-brew-1": "bg-vessel-1", // indigo
  "vessel-brew-2": "bg-vessel-2", // plum
  "vessel-brew-3": "bg-vessel-3", // olive
  "vessel-brew-4": "bg-vessel-4", // clay
};

export function vesselHueClass(vesselId: string): string {
  const pinned = PINNED[vesselId];
  if (pinned) return pinned;
  let h = 7;
  for (const ch of vesselId) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return HUES[Math.abs(h) % HUES.length]!;
}
