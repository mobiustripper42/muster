/**
 * `db:xola:report` — pull reservations straight from the Xola API and print them with their
 * LINE ITEMS and the boat, so passenger counts can be audited.
 *
 * **Why this exists.** `item.quantity` is what the importer stores as party size
 * (`xola-client.ts:277`), and per the operator that is not the number of people on the boat —
 * the real head count is only derivable from the ADD-ONS. Nothing in Muster parses add-ons
 * today, so there is no stored answer to check against; this reads the API directly.
 *
 * **It writes nothing.** Read-only against Xola, no database, no import run. Safe to point at
 * production credentials, which is the point — the data being audited is the live data.
 *
 * ```
 *   npm run db:xola:report -- --raw 2            # DO THIS FIRST: full JSON of 2 orders
 *   npm run db:xola:report -- --from 2026-08-01 --to 2026-10-31
 *   npm run db:xola:report -- --csv > /tmp/xola.csv
 * ```
 *
 * **Run `--raw` first.** Every field this file reads beyond the four the importer already uses
 * is a guess until it is seen in a real response, and guessing at a third-party shape is exactly
 * how you write code against something that isn't there. `--raw` prints whole orders verbatim;
 * the table below then reports every line item it finds rather than assuming which one is the
 * add-on, so it stays honest even before the shape is known.
 */
import { existsSync } from "node:fs";
import {
  XOLA_API_BASE_DEFAULT,
  XOLA_API_VERSION,
  fetchEvents,
  fetchOrders,
  makeXolaFetcher,
  type XolaEvent,
  type XolaOrder,
} from "../src/import/xola-client.js";
import { resolveResource } from "../src/import/resource-map.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (flag: string): boolean => process.argv.includes(flag);

const apiKey = process.env.XOLA_API_KEY;
const sellerId = process.env.XOLA_SELLER_ID;
if (!apiKey || !sellerId) {
  console.error(
    "Set XOLA_API_KEY and XOLA_SELLER_ID (in .env.local or inline). This reads Xola only — it writes nothing.",
  );
  process.exit(1);
}

/** Default window: a month back for recent history, six months forward for the season. */
const today = new Date().toISOString().slice(0, 10);
const shift = (days: number): string => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
// Default: TODAY FORWARD. This is an operational report about trips that have not sailed yet —
// a booking last week being over capacity is history, not something anyone can act on.
const from = arg("--from") ?? today;
// Two years, not six months. A +180d default silently dropped a real 2027-07-15 booking on the
// first live run — and the failure mode of a too-short horizon is invisible: the report looks
// complete, it just ends. The pull is chunked and cheap, so the horizon costs nothing to widen.
const to = arg("--to") ?? shift(730);
const onlyFlagged = has("--flagged");

const fetcher = makeXolaFetcher({
  apiKey,
  sellerId,
  base: process.env.XOLA_API_BASE || XOLA_API_BASE_DEFAULT,
  apiVersion: process.env.XOLA_API_VERSION || XOLA_API_VERSION,
});

/**
 * Pull a date range in chunks, subdividing any chunk the API refuses.
 *
 * **`fetchOrders` cannot read past the first page.** Ask for a window holding more than 100
 * orders and page two comes back **404** (`…&skip=100`), verified against the live API on
 * 2026-08-10. That is the same `fetchOrders` behind the operator's "Pull from Xola now", so the
 * real importer has the same ceiling — filed separately; this report cannot wait for it.
 *
 * The workaround is to never ask for more than a page: slice the range, and halve any slice that
 * still throws, down to a single day. Orders are deduped by ITEM id because a chunk boundary can
 * return the same order twice (the filter is on item arrival, and one order can hold items on
 * either side of a cut).
 */
/** Xola's page size. A chunk that comes back at or above this is presumed truncated. */
const PAGE_LIMIT = 100;

async function pullWindowed(start: string, end: string, depth = 0): Promise<XolaOrder[]> {
  let page: XolaOrder[] | null = null;
  try {
    page = await fetchOrders(fetcher, { sellerId: sellerId!, start, end });
    // **A full page is treated as a FAILURE, not a result.** The 404 on page two is the loud
    // version of this bug; the quiet version is a chunk that returns exactly 100 with no
    // `paging.next`, where `fetchOrders` stops cleanly and the report silently omits everything
    // after the hundredth booking. Splitting on the count as well as on the throw means the
    // only way to lose a row is a SINGLE DAY holding 100+ orders, which logs loudly below.
    if (page.length < PAGE_LIMIT) return page;
    if (start === end) {
      console.error(
        `  ! ${start} alone holds ${page.length} orders — at the page limit and not splittable. ` +
          `ROWS ARE PROBABLY MISSING for this day.`,
      );
      return page;
    }
    console.error(`  … ${start}…${end} returned a full page (${page.length}), splitting`);
  } catch (e) {
    if (start === end || depth > 8) {
      console.error(`  ! ${start}…${end} failed and cannot be split further: ${String(e)}`);
      return [];
    }
    console.error(`  … ${start}…${end} over one page, splitting`);
  }
  {
    const a = new Date(`${start}T00:00:00Z`).getTime();
    const b = new Date(`${end}T00:00:00Z`).getTime();
    const midIso = new Date(a + Math.floor((b - a) / 2)).toISOString().slice(0, 10);
    const nextIso = new Date(new Date(`${midIso}T00:00:00Z`).getTime() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const left = await pullWindowed(start, midIso, depth + 1);
    const right = await pullWindowed(nextIso, end, depth + 1);
    return [...left, ...right];
  }
}

console.error(`Pulling Xola orders, arrival ${from} … ${to}`);
const CHUNK_DAYS = Number(arg("--chunk") ?? 14);
const chunks: [string, string][] = [];
for (let t = new Date(`${from}T00:00:00Z`).getTime(); ; ) {
  const endT = Math.min(t + (CHUNK_DAYS - 1) * 86_400_000, new Date(`${to}T00:00:00Z`).getTime());
  chunks.push([
    new Date(t).toISOString().slice(0, 10),
    new Date(endT).toISOString().slice(0, 10),
  ]);
  if (endT >= new Date(`${to}T00:00:00Z`).getTime()) break;
  t = endT + 86_400_000;
}

const seenItems = new Set<string>();
const orders: XolaOrder[] = [];
for (const [a, b] of chunks) {
  const page = await pullWindowed(a, b);
  for (const o of page) {
    const items = (o.items ?? []).filter((it) => {
      const id = (it.id ?? "").trim();
      if (!id || seenItems.has(id)) return false;
      seenItems.add(id);
      return true;
    });
    if (items.length) orders.push({ ...o, items });
  }
}
console.error(`  ${orders.length} orders, ${seenItems.size} reservation lines`);

// ── `--raw`: the whole order, verbatim ───────────────────────────────────────
// Run this before trusting any column below. It is the only way to learn where add-ons live
// without guessing, and the shape is not documented anywhere in this repo.
if (has("--raw")) {
  const n = Number(arg("--raw")) || 2;
  console.log(JSON.stringify(orders.slice(0, n), null, 2));
  process.exit(0);
}

// ── the boat, per event (DEC-043) ────────────────────────────────────────────
// The vessel is a Resource on the trip's EVENT, never derivable from the order. `/events`
// ignores date filters and returns a now-forward window, so a past trip may resolve to "—".
const events: XolaEvent[] = await fetchEvents(fetcher, { sellerId });
const spans = events.map((e) => e.start ?? "").filter(Boolean).sort();
console.error(
  `  ${events.length} events for the boat join, spanning ${spans[0]?.slice(0, 10)} … ${spans[spans.length - 1]?.slice(0, 10)}`,
);

const boatByEvent = new Map<string, string>();
const nameResource = (id: string, usages: XolaEvent["resourceUsages"]): void => {
  for (const usage of usages ?? []) {
    const rid = usage.resource?.id;
    if (!rid) continue;
    const r = resolveResource(rid);
    // Take the first that names a real boat; a self-captained Duffy is named too, since this
    // is a report about what Xola holds rather than about what Muster crews.
    if (r.kind === "mapped") {
      boatByEvent.set(id, r.vessel.name);
      return;
    }
    if (r.kind === "ignored" && !boatByEvent.has(id)) boatByEvent.set(id, `(${r.reason})`);
  }
};
for (const ev of events) {
  const id = (ev.id ?? "").trim();
  if (id) nameResource(id, ev.resourceUsages);
}

/**
 * **`/events` covers a narrow window, and it is not the one you asked for.** Live on 2026-08-10
 * it returned 151 events spanning 08-14 → 09-06 — not today, and not October. Every trip outside
 * that band resolved to no boat, and a row with no boat gets NO capacity check: the report
 * printed it looking clean while declining to audit it. That is worse than an error, because an
 * unaudited row is indistinguishable from a passing one.
 *
 * It was caught by the operator noticing an expected 08-10 problem was absent, not by the code.
 * So: any event the list did not carry is fetched individually — `/events/<id>` works fine and
 * returns the same `resourceUsages`. One request per missing event, and they are logged.
 */
const missing = new Set<string>();
for (const order of orders) {
  for (const item of order.items ?? []) {
    const id = (item.event?.id ?? "").trim();
    if (id && !boatByEvent.has(id)) missing.add(id);
  }
}
if (missing.size) {
  console.error(`  ${missing.size} event(s) outside that span — fetching individually`);
  for (const id of missing) {
    try {
      const one = (await fetcher(`/events/${id}`)) as XolaEvent;
      nameResource(id, one.resourceUsages);
    } catch (e) {
      console.error(`  ! /events/${id} failed: ${String(e).slice(0, 120)}`);
    }
  }
}
const stillUnknown = [...missing].filter((id) => !boatByEvent.has(id));
if (stillUnknown.length) {
  console.error(
    `  ! ${stillUnknown.length} event(s) STILL have no boat — those rows are UNAUDITED for capacity.`,
  );
}

/**
 * The passenger model, read off real orders (2026-08-10) rather than guessed.
 *
 * A booking is ONE BOAT — `item.quantity` is 1 on every order, and `demographics` says
 * `Adults × 1`, which is why neither is the head count. The base experience includes
 * **{BASE} guests**; beyond that the customer buys an `Extra Tickets: $40/person` add-on whose
 * `quantity` IS the number of extra people. So:
 *
 *     passengers = base + Σ(quantity of "Extra Tickets" add-ons)
 *
 * `--base` is a flag and the value is printed in the header, because the 12 is not a fact this
 * script can verify — it comes from the operator's own add-on copy ("if I have more than 12
 * people I need to call BrewBoat"), and Brew 1 (14) and Brew 2 (16) are bigger boats.
 *
 * Two things get FLAGGED, and they are different failures:
 *
 *  - **`declared≠paid`** — the checkout also asks "Are you interested in adding more guests over
 *    12?" and records the answer as its own add-on ("Yes-two more" / "No-Good with 12"). That is
 *    a statement of intent; the Extra Tickets line is what was actually paid for. When they
 *    disagree, somebody is coming with more people than they bought seats for. Real orders carry
 *    BOTH answers on one booking (a customer changed their mind and Xola kept both), so this is
 *    reported as every answer found, not as a single value.
 *  - **`over capacity`** — passengers exceed the assigned boat's COI cap. That one is a legal
 *    limit, not an invoicing question.
 */
const BASE_GUESTS = Number(arg("--base") ?? 12);

/** Add-on rows are `{quantity, amount, configuration:{name}}`. Only the name identifies them. */
interface XolaAddOn {
  quantity?: number;
  amount?: number;
  configuration?: { name?: string };
}

const EXTRA_TICKETS = /^extra tickets/i;
const MORE_GUESTS = /adding more guests over \d+\?:\s*(.+)$/i;
/** "Yes-two more" → 2. The checkout offers words, not digits. */
const WORD: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function readAddOns(item: Record<string, unknown>): {
  extra: number;
  declared: string[];
  declaredMax: number | null;
} {
  const addOns = (item.addOns ?? []) as XolaAddOn[];
  let extra = 0;
  const declared: string[] = [];
  let declaredMax: number | null = null;
  for (const a of addOns) {
    const name = (a.configuration?.name ?? "").trim();
    if (EXTRA_TICKETS.test(name)) {
      extra += typeof a.quantity === "number" ? a.quantity : 0;
      continue;
    }
    const m = MORE_GUESTS.exec(name);
    if (!m) continue;
    const answer = (m[1] ?? "").trim();
    declared.push(answer);
    // "No-Good with 12" ⇒ 0; "Yes-two more" ⇒ 2. An unrecognised phrasing is left null rather
    // than coerced to 0 — reporting "declared 0" for a sentence nobody parsed would invent a
    // clean answer out of an unknown one.
    if (/^no\b/i.test(answer)) declaredMax = Math.max(declaredMax ?? 0, 0);
    else {
      const w = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(answer);
      const n = w ? WORD[w[1]!.toLowerCase()] : Number((/\b(\d+)\b/.exec(answer) ?? [])[1]);
      if (typeof n === "number" && Number.isFinite(n)) declaredMax = Math.max(declaredMax ?? 0, n);
    }
  }
  return { extra, declared, declaredMax };
}

interface Row {
  date: string;
  time: string;
  boat: string;
  cap: string;
  customer: string;
  status: string;
  pax: string;
  extra: string;
  declared: string;
  flags: string;
}

const CAPACITY: Record<string, number> = {
  "Brew 1": 14,
  "Brew 2": 16,
  "Brew 3": 12,
  "Brew 4": 12,
};

const rows: Row[] = [];
for (const order of orders) {
  for (const item of order.items ?? []) {
    const raw = item as unknown as Record<string, unknown>;
    const { extra, declared, declaredMax } = readAddOns(raw);
    const eventId = (item.event?.id ?? "").trim();
    const boat = (eventId && boatByEvent.get(eventId)) || "—";
    const cap = CAPACITY[boat];
    const pax = BASE_GUESTS + extra;
    const dt = item.arrivalDatetime ?? "";

    const flags: string[] = [];
    if (declaredMax !== null && declaredMax !== extra) {
      flags.push(`declared ${declaredMax}≠paid ${extra}`);
    }
    if (declared.length > 1) flags.push("two answers");
    if (cap !== undefined && pax > cap) flags.push(`OVER ${boat} cap ${cap}`);
    if (item.status === 700) flags.push("cancelled");

    rows.push({
      date: item.arrival ?? dt.slice(0, 10),
      time: dt.slice(11, 16) || String(item.arrivalTime ?? ""),
      boat,
      cap: cap === undefined ? "" : String(cap),
      customer: (order.customerName ?? "").trim(),
      status: String(item.status ?? ""),
      pax: String(pax),
      extra: String(extra),
      declared: declared.join(" | "),
      flags: flags.join("; "),
    });
  }
}
rows.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

const COLS: (keyof Row)[] = [
  "date", "time", "boat", "cap", "customer", "status", "pax", "extra", "declared", "flags",
];

/** `--flagged` narrows to the rows that need a decision. A cancelled line is not one. */
const shown = onlyFlagged
  ? rows.filter((r) => r.flags && r.flags !== "cancelled")
  : rows;

if (has("--csv")) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  console.log(COLS.join(","));
  for (const r of shown) console.log(COLS.map((c) => esc(r[c])).join(","));
} else {
  const cap = (c: keyof Row) => (c === "declared" ? 34 : c === "flags" ? 0 : 22);
  const widths = COLS.map((c) =>
    cap(c) === 0 ? 0 : Math.min(cap(c), Math.max(c.length, ...rows.map((r) => r[c].length), 1)),
  );
  const line = (vals: string[]) =>
    vals.map((v, i) => (widths[i] ? v.slice(0, widths[i]).padEnd(widths[i]) : v)).join("  ");
  console.log(`\nbase ${BASE_GUESTS} guests included; pax = base + Extra Tickets\n`);
  console.log(line(COLS as string[]));
  console.log(line(COLS.map((c, i) => "-".repeat(widths[i] || c.length))));
  for (const r of shown) console.log(line(COLS.map((c) => r[c])));
}

const flagged = rows.filter((r) => r.flags && r.flags !== "cancelled");
console.error(`\n${rows.length} reservation line(s), ${flagged.length} flagged.`);

const overCap = rows.filter((r) => r.flags.includes("OVER"));
if (overCap.length) {
  console.error(`\nOVER CAPACITY — ${overCap.length}:`);
  for (const r of overCap) {
    console.error(`  ${r.date} ${r.time}  ${r.boat} (cap ${r.cap})  ${r.customer}  ${r.pax} pax`);
  }
}
const unpaid = rows.filter((r) => r.flags.includes("declared"));
if (unpaid.length) {
  console.error(`\nDECLARED MORE THAN PAID FOR — ${unpaid.length}:`);
  for (const r of unpaid) {
    console.error(`  ${r.date} ${r.time}  ${r.boat}  ${r.customer}  ${r.flags}`);
  }
}
