/**
 * Trip links (Phase 18.3b, issue #1141, DEC-190) — one code per departure, and what opening it
 * resolves to.
 *
 * The link the booker shares with the party, and the one behind the dock QR, is `/w/<code>`. The
 * page lists booker surnames on a shared departure, so the link must not be guessable from an event
 * id (`docs/design/check-in-and-waivers.md` §7). It is public within the party, so it is stored as
 * it is and never revoked (operator, 2026-09-29).
 *
 * **8 characters of the booking-code alphabet** (`booking-code.ts`): 32^8 ≈ 1.1×10^12. Against the
 * 120-a-minute limit per address, and even with a thousand live trips, a guesser needs about a
 * billion tries per hit. The length has to hold on its own, because spreading guesses over many
 * addresses gets around a per-address limit.
 */
import { randomBytes } from "node:crypto";
import type { Buffer } from "node:buffer";
import { stripTrailingSlashes } from "../config/base-url.js";
import type { EventId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { takeRateLimit, type RateLimitDeps, type RateLimitPolicy } from "../rate-limit/rate-limit.js";
import { hasDeparted } from "../reservations/availability.js";
import { BOOKING_CODE_ALPHABET } from "../reservations/booking-code.js";

export const TRIP_CODE_LENGTH = 8;

/**
 * Opens per client address per minute (DEC-189). Well above a gangway crowd on one Wi-Fi, and the
 * code's length does the real work. Fails open: a guest at the dock must never be locked out by a
 * broken counter (the spec's "nothing blocks departure").
 */
export const TRIP_LINK_LIMIT: RateLimitPolicy = {
  bucket: "trip-link",
  limit: 120,
  windowMs: 60_000,
  failOpen: true,
};

/** How many codes to try before giving up — the `ensureBookingCode` shape. */
const MINT_ATTEMPTS = 3;

const TRIP_CODE_RE = new RegExp(`^[${BOOKING_CODE_ALPHABET}]{${TRIP_CODE_LENGTH}}$`);

/**
 * A fresh code from cryptographic randomness. `bytes` is injected only so tests can pin the output.
 * The alphabet is 32 characters, so `byte & 31` is exactly uniform.
 */
export function mintTripCode(bytes: (n: number) => Buffer = randomBytes): string {
  const buf = bytes(TRIP_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < TRIP_CODE_LENGTH; i++) out += BOOKING_CODE_ALPHABET[(buf[i] ?? 0) & 31];
  return out;
}

/**
 * A code as it arrives from a URL or is typed back from a text: uppercased, spaces and dashes
 * dropped, I and L read as 1 and O as 0 (the alphabet leaves them out). Null when it cannot be a
 * code, so junk never reaches the database.
 */
export function normalizeTripCode(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 64) return null;
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/[\s-]/g, "");
  return TRIP_CODE_RE.test(cleaned) ? cleaned : null;
}

/** The link to share. `base` is the trusted `APP_BASE_URL`, never a Host header. */
export function tripLinkUrl(base: string, code: string): string {
  return `${stripTrailingSlashes(base)}/w/${code}`;
}

/**
 * The departure's code, made the first time it is asked for. Idempotent: the first code is the
 * code forever. A collision with another trip's code mints again; a race with another request
 * minting for the SAME trip reads back the winner's.
 */
export async function ensureTripLink(
  repo: Repository,
  eventId: EventId,
  now: () => string,
  bytes?: (n: number) => Buffer,
): Promise<string> {
  const existing = await repo.getTripLinkForEvent(eventId);
  if (existing) return existing.code;

  let lastError: unknown;
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    const code = bytes ? mintTripCode(bytes) : mintTripCode();
    try {
      await repo.insertTripLink({ code, eventId, createdAt: now() });
      return code;
    } catch (e) {
      if (!isDuplicate(e)) throw e;
      // Either this trip got a link from a concurrent request, or the code belongs to another trip.
      const winner = await repo.getTripLinkForEvent(eventId);
      if (winner) return winner.code;
      lastError = e;
    }
  }
  throw lastError;
}

function isDuplicate(e: unknown): boolean {
  return e instanceof Error && e.message.toLowerCase().includes("duplicate key");
}

/** The departure a link opens, as the guest page needs it. The boat is never named to a customer. */
export interface TripLinkTrip {
  eventId: EventId;
  /** Vessel-local `YYYY-MM-DD`. */
  date: string;
  /** Vessel-local `HH:mm`. */
  time: string;
}

export type TripLinkView =
  | { state: "not_found" }
  | { state: "open" | "departed" | "cancelled"; trip: TripLinkTrip };

/**
 * What a code opens, at `now`. Cancelled wins over departed: a cancelled trip never sailed.
 * "Departed" is `hasDeparted`, the same rule the booking side uses, from the departure time on.
 */
export async function resolveTripLink(repo: Repository, rawCode: string, now: string): Promise<TripLinkView> {
  const code = normalizeTripCode(rawCode);
  if (!code) return { state: "not_found" };
  const link = await repo.getTripLinkByCode(code);
  if (!link) return { state: "not_found" };
  const event = await repo.getEvent(link.eventId);
  if (!event) return { state: "not_found" };

  const trip = { eventId: event.id, date: event.date, time: event.time };
  if (event.status === "cancelled") return { state: "cancelled", trip };
  if (hasDeparted(event.date, event.time, now)) return { state: "departed", trip };
  return { state: "open", trip };
}

/**
 * Open a link as the guest page does: **limited first**, then resolved. Over the limit, nothing is
 * looked up — a guess and a real code get the same answer, so the limit bounds guessing.
 */
export async function openTripLink(
  deps: Omit<RateLimitDeps, "now"> & { now: () => string },
  rawCode: string,
  clientKey: string | null,
): Promise<TripLinkView | { state: "throttled"; retryAfterMs: number }> {
  const limit = await takeRateLimit(deps, TRIP_LINK_LIMIT, clientKey);
  if (!limit.allowed) return { state: "throttled", retryAfterMs: limit.retryAfterMs };
  return resolveTripLink(deps.repo, rawCode, deps.now());
}
