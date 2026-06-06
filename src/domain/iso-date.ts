/**
 * ISO-8601 validation — the executable half of the no-FK / dates-as-text bet
 * (DEC-020, DEC-DATA-1).
 *
 * Persistence stores every date/time field as plain `text`, round-tripped
 * verbatim, with no DB-level CHECK and no type coercion (that's what keeps the
 * Postgres adapter byte-equivalent to the in-memory double). The price of that
 * bet is that `"2026-13-99"` will happily persist unless something rejects it at
 * the door. These validators ARE that door: the service layer mints/validates
 * dates through them at every write boundary, so a malformed string never reaches
 * storage. Without this, text dates rot silently — there is no FK or CHECK to
 * scream. (Runtime validators rather than branded types — DEC chosen at PR 3;
 * full branding of the `string` date fields is a deferred follow-up.)
 *
 * Framework-free, no `now`, no I/O — pure predicates the whole core can call.
 */

/** A bad date/time value caught at a write boundary. */
export class IsoDateError extends Error {
  constructor(
    readonly field: string,
    readonly value: unknown,
  ) {
    super(`Invalid ISO-8601 value for ${field}: ${JSON.stringify(value)}`);
    this.name = "IsoDateError";
  }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// toISOString() shape: YYYY-MM-DDTHH:mm:ss.sssZ — UTC, millis, trailing Z.
const DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
const CLOCK_RE = /^(\d{2}):(\d{2})$/;

/**
 * Calendar-true `YYYY-MM-DD`. Rejects not just the wrong shape but impossible
 * days — `2026-13-01`, `2026-02-30` — by re-deriving the components from a UTC
 * Date and demanding they match (catches month/day overflow that a regex can't).
 */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

/**
 * A UTC ISO-8601 instant in the exact shape `Date.prototype.toISOString`
 * produces (`...sss Z`) — the only datetime form the core ever writes. Requiring
 * that canonical shape (not just any parseable date) keeps stored timestamps
 * uniform and comparable as plain strings.
 */
export function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!DATETIME_RE.exec(value)) return false;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return false;
  // Re-serialize and compare: rejects real-looking-but-impossible instants
  // (e.g. 2026-02-30T...) that Date.parse would silently roll forward.
  return new Date(t).toISOString() === value;
}

/** A wall-clock `HH:mm` (event departure time — not a date, but date-adjacent). */
export function isClockTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = CLOCK_RE.exec(value);
  if (!m) return false;
  return Number(m[1]) < 24 && Number(m[2]) < 60;
}

/** Throw `IsoDateError` unless `value` is a calendar-true `YYYY-MM-DD`. */
export function assertIsoDate(value: unknown, field: string): asserts value is string {
  if (!isIsoDate(value)) throw new IsoDateError(field, value);
}

/** Throw `IsoDateError` unless `value` is a canonical UTC ISO-8601 instant. */
export function assertIsoDateTime(value: unknown, field: string): asserts value is string {
  if (!isIsoDateTime(value)) throw new IsoDateError(field, value);
}

/** Throw `IsoDateError` unless `value` is an `HH:mm` clock time. */
export function assertClockTime(value: unknown, field: string): asserts value is string {
  if (!isClockTime(value)) throw new IsoDateError(field, value);
}

/** Same as {@link assertIsoDate} but tolerates an absent (optional) value. */
export function assertOptionalIsoDateTime(
  value: unknown,
  field: string,
): asserts value is string | undefined {
  if (value === undefined) return;
  assertIsoDateTime(value, field);
}
