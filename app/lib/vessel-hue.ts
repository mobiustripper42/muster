/**
 * Vessel identity hue (DEC-086) — which `--color-vessel-N` token a vessel's
 * board dot renders in.
 *
 * As of 12.9 the hue is an **operator-chosen Vessel fact** (`Vessel.hue`, 1–6): when set,
 * it is authoritative everywhere a vessel dot renders (shift board, crew lists, reservation
 * calendar). When absent, the legacy derivation stands — the real fleet is PINNED (chosen,
 * the DEC's guardrail), and anything unpinned (dev seeds, a not-yet-coloured boat) falls back
 * to a stable hash, so a given vessel id always lands on the same hue across renders. This
 * keeps every existing vessel's colour identical until an operator picks one.
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

/** How many palette hues exist — the picker + the stored-hue range both cap here. */
export const HUE_COUNT = HUES.length;

/** The chosen assignment for the real fleet (src/import/resource-map.ts). */
const PINNED: Record<string, (typeof HUES)[number]> = {
  "vessel-brew-1": "bg-vessel-1", // indigo
  "vessel-brew-2": "bg-vessel-2", // plum
  "vessel-brew-3": "bg-vessel-3", // olive
  "vessel-brew-4": "bg-vessel-4", // clay
};

/**
 * @param vesselId  the boat's id — keys the PINNED map + the hash fallback.
 * @param storedHue the operator-chosen `Vessel.hue` (1–6). When a valid index, it WINS over
 *                  the derivation; anything out of range or null falls through to PINNED/hash.
 */
export function vesselHueClass(vesselId: string, storedHue?: number | null): string {
  if (typeof storedHue === "number" && storedHue >= 1 && storedHue <= HUES.length) {
    return HUES[storedHue - 1]!;
  }
  const pinned = PINNED[vesselId];
  if (pinned) return pinned;
  let h = 7;
  for (const ch of vesselId) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return HUES[Math.abs(h) % HUES.length]!;
}
