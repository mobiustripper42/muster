/**
 * The guest intro text (#345) — the message an operator/crew member sends a booked
 * guest before a cruise, preloaded into the phone's Messages app via an `sms:` deep
 * link so they just hit send (no more hand-typing it every trip).
 *
 * Pure string assembly (framework-free core, so it's unit-tested): the surface
 * formats the departure time and resolves the sender's name + the pickup config,
 * hands them here, and gets back the exact body. Kept subtractive of surprises —
 * the sender's FIRST name only (friendlier, and we never leak a full legal name),
 * with a graceful fallback so an empty name never yields "Hi, this is  with…".
 *
 * "today" is literal by design: this is a day-of tool (the operator texts guests
 * the morning of). If it ever needs to run ahead, swap "today" for the trip date.
 */

/** First token of a name, trimmed. "" when there's nothing usable. */
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

export function buildIntroText(p: {
  /** The sender's name (full is fine — only the first token is used). */
  senderName: string | null | undefined;
  /** Departure time already formatted for humans, e.g. "11:30 AM". */
  departureLabel: string;
  /** The pickup location string (PICKUP_LOCATION). */
  location: string;
  /** The Google Maps pin URL (PICKUP_MAP_URL). */
  mapUrl: string;
}): string {
  const first = firstName(p.senderName);
  // With a name: "Hi, this is Eric with BrewBoat". Without: drop the name cleanly
  // rather than render an empty gap.
  const intro = first ? `Hi, this is ${first} with BrewBoat` : `Hi, this is BrewBoat`;
  return (
    `${intro} — I'll be taking you out at ${p.departureLabel} today. ` +
    `Please confirm the pickup location: ${p.location}. ${p.mapUrl}`
  );
}
