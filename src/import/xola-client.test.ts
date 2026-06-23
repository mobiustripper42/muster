/**
 * Xola API Land adapter (DEC-036 → DEC-043) — the pure mapper, the events→vessel
 * join, pagination, and the retrying real fetcher. Fixtures use the REAL resource
 * ids + the offset/Z time shapes verified against live prod (Session 22), so the
 * field paths and the wall-clock slice are real, not guessed.
 */

import { describe, expect, it, vi } from "vitest";
import { asId } from "../domain/ids.js";
import type { VesselId } from "../domain/ids.js";
import {
  CANCELLED_STATUS_CODE,
  eventVesselMap,
  fetchEvents,
  fetchOrders,
  makeXolaFetcher,
  mapXolaOrders,
  ordersPath,
  PULL_STATUS_CODES,
  XolaError,
} from "./xola-client.js";
import type { XolaEnv, XolaEvent, XolaOrder, XolaPage } from "./xola-client.js";

// Real Xola resource ids → vessels (validated live, Session 22).
const RES_BREW2 = "656e10ce46c61175bd0de305";
const RES_BREW3 = "656e0fcdf9f593e84b0e1782";
const RES_DUFFY = "656e0f760c4f4326c10c1b8b";
const V_BREW2 = asId<"VesselId">("vessel-brew-2");
const V_BREW3 = asId<"VesselId">("vessel-brew-3");

const xEvent = (id: string, resourceId: string | null, start = "2026-07-04T18:00:00+00:00"): XolaEvent => ({
  id,
  start,
  ...(resourceId ? { resourceUsages: [{ resource: { id: resourceId } }] } : {}),
});

/** Trimmed from a real order; item carries its `event.id` join key (DEC-043). */
const SANDBOX_ORDER: XolaOrder = {
  id: "6a0fb153fc23e25a0f004d45",
  customerName: "Robert H",
  phone: "440 333 1155",
  phoneCanonical: "4403331155",
  items: [
    {
      id: "6a0fb153fc23e25a0f004d46",
      name: "Brew Boat Party Boats with Captain",
      arrival: "2026-06-06",
      arrivalTime: 1800,
      arrivalDatetime: "2026-06-06T18:00:00-04:00",
      quantity: 1,
      status: 200,
      event: { id: "evt-sandbox" },
    },
  ],
};

/** evt-sandbox is boated on Brew 2 — the join the mapper resolves against. */
const VESSELS = new Map<string, VesselId>([["evt-sandbox", V_BREW2]]);

describe("eventVesselMap — events → resolved boats", () => {
  it("resolves a boated event to its crewed vessel", () => {
    const { vessels } = eventVesselMap([xEvent("evt-1", RES_BREW2), xEvent("evt-2", RES_BREW3)]);
    expect(vessels.get("evt-1")).toBe(V_BREW2);
    expect(vessels.get("evt-2")).toBe(V_BREW3);
  });

  it("excludes self-captained Duffy resources (counted, not crewed)", () => {
    const { vessels, excluded } = eventVesselMap([xEvent("evt-d", RES_DUFFY)]);
    expect(vessels.size).toBe(0);
    expect(excluded).toBe(1);
  });

  it("quarantines an unknown resource id (DEC-018)", () => {
    const { vessels, unmapped } = eventVesselMap([xEvent("evt-x", "deadbeefdeadbeefdeadbeef")]);
    expect(vessels.size).toBe(0);
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0]!.reason).toMatch(/unmapped resource/i);
  });

  it("ignores a boat-less event (no resourceUsages) — not an error", () => {
    const { vessels, excluded, unmapped } = eventVesselMap([xEvent("evt-empty", null)]);
    expect(vessels.has("evt-empty")).toBe(false);
    expect(excluded).toBe(0);
    expect(unmapped).toEqual([]);
  });
});

describe("mapXolaOrders — orders ⨝ events → records", () => {
  it("stamps the resolved vesselId + real eventId on a booked record", () => {
    const { records, skipped } = mapXolaOrders([SANDBOX_ORDER], VESSELS);
    expect(skipped).toEqual([]);
    expect(records).toEqual([
      {
        reservationId: "6a0fb153fc23e25a0f004d46",
        product: "Brew Boat Party Boats with Captain",
        date: "2026-06-06",
        time: "18:00",
        eventId: "evt-sandbox",
        vesselId: V_BREW2,
        customerName: "Robert H",
        partySize: 1,
        status: "booked",
        phone: "4403331155", // phoneCanonical preferred
      },
    ]);
  });

  it("explodes a multi-item order into one record per item", () => {
    const order: XolaOrder = {
      ...SANDBOX_ORDER,
      items: [
        SANDBOX_ORDER.items![0]!,
        { ...SANDBOX_ORDER.items![0]!, id: "item-2", arrivalDatetime: "2026-06-07T09:30:00-04:00" },
      ],
    };
    const { records } = mapXolaOrders([order], VESSELS);
    expect(records.map((r) => [r.reservationId, r.date, r.time])).toEqual([
      ["6a0fb153fc23e25a0f004d46", "2026-06-06", "18:00"],
      ["item-2", "2026-06-07", "09:30"],
    ]);
  });

  it("skips a BOOKED item whose event isn't boated/in-window", () => {
    const order: XolaOrder = {
      ...SANDBOX_ORDER,
      items: [{ ...SANDBOX_ORDER.items![0]!, event: { id: "evt-not-in-feed" } }],
    };
    const { records, skipped } = mapXolaOrders([order], VESSELS);
    expect(records).toHaveLength(0);
    expect(skipped[0]!.reason).toMatch(/not boated/i);
  });

  it("emits a CANCELLED item even without a resolved boat (de-boated trip)", () => {
    const order: XolaOrder = {
      ...SANDBOX_ORDER,
      items: [{ ...SANDBOX_ORDER.items![0]!, status: 700, event: { id: "evt-not-in-feed" } }],
    };
    const { records } = mapXolaOrders([order], VESSELS);
    expect(records).toHaveLength(1);
    expect(records[0]!.status).toBe("cancelled");
    expect(records[0]!.vesselId).toBeUndefined();
    expect(records[0]!.eventId).toBe("evt-not-in-feed");
  });

  it("skips an item with no event ref", () => {
    const noEvent = { ...SANDBOX_ORDER.items![0]! };
    delete noEvent.event;
    const order: XolaOrder = { ...SANDBOX_ORDER, items: [noEvent] };
    const { records, skipped } = mapXolaOrders([order], VESSELS);
    expect(records).toHaveLength(0);
    expect(skipped[0]!.reason).toMatch(/missing event ref/i);
  });

  it("maps item status 700 to cancelled, the booked family to booked", () => {
    const cancelled = mapXolaOrders(
      [{ ...SANDBOX_ORDER, items: [{ ...SANDBOX_ORDER.items![0]!, status: CANCELLED_STATUS_CODE }] }],
      VESSELS,
    );
    expect(cancelled.records[0]!.status).toBe("cancelled");
    for (const code of [200, 201, 202, 203]) {
      const r = mapXolaOrders(
        [{ ...SANDBOX_ORDER, items: [{ ...SANDBOX_ORDER.items![0]!, status: code }] }],
        VESSELS,
      );
      expect(r.records[0]!.status).toBe("booked");
    }
  });

  it("falls back to arrival + arrivalTime when arrivalDatetime is absent (HHMM padded)", () => {
    const { records } = mapXolaOrders(
      [{ ...SANDBOX_ORDER, items: [{ id: "i", name: "X", arrival: "2026-07-04", arrivalTime: 930, status: 200, event: { id: "evt-sandbox" } }] }],
      VESSELS,
    );
    expect([records[0]!.date, records[0]!.time]).toEqual(["2026-07-04", "09:30"]);
  });

  it("omits phone when the order has neither phone nor phoneCanonical", () => {
    const { records } = mapXolaOrders(
      [{ id: "o", customerName: "No Phone", items: [SANDBOX_ORDER.items![0]!] }],
      VESSELS,
    );
    expect(records[0]!.phone).toBeUndefined();
  });

  it("skips an item missing id, product name, or a parseable arrival — never aborts", () => {
    const { records, skipped } = mapXolaOrders(
      [
        {
          id: "o",
          customerName: "C",
          items: [
            { name: "no id", arrivalDatetime: "2026-06-06T18:00:00-04:00", status: 200, event: { id: "evt-sandbox" } },
            { id: "no-name", arrivalDatetime: "2026-06-06T18:00:00-04:00", status: 200, event: { id: "evt-sandbox" } },
            { id: "bad-date", name: "Y", arrival: "nope", status: 200, event: { id: "evt-sandbox" } },
            SANDBOX_ORDER.items![0]!, // the good one still lands
          ],
        },
      ],
      VESSELS,
    );
    expect(records).toHaveLength(1);
    expect(skipped.map((s) => s.reason)).toEqual([
      "item missing id",
      "item missing product name",
      expect.stringContaining("unparseable arrival"),
    ]);
  });
});

describe("ordersPath", () => {
  it("sets the seller, the arrival window, the status filter (incl. 700), and limit", () => {
    const path = ordersPath({ sellerId: "seller-1", start: "2026-06-17", end: "2026-06-26" });
    const qs = new URLSearchParams(path.split("?")[1]);
    expect(qs.get("seller")).toBe("seller-1");
    expect(qs.get("items.arrival[gte]")).toBe("2026-06-17");
    expect(qs.get("items.arrival[lte]")).toBe("2026-06-26");
    expect(qs.get("items.status[in]")).toBe(PULL_STATUS_CODES.join(","));
    expect(qs.get("items.status[in]")).toContain("700"); // cancellations included
  });
});

describe("fetchOrders — skip pagination", () => {
  const order = (id: string): XolaOrder => ({ id, items: [] });

  it("follows paging.next until a short page lands", async () => {
    const paths: string[] = [];
    const pages: XolaPage[] = [
      { data: [order("a"), order("b")], paging: { next: "/orders?skip=2" } },
      { data: [order("c")], paging: { next: "/orders?skip=4" } }, // short → stop
    ];
    const fetcher = async (p: string): Promise<XolaPage> => {
      paths.push(p);
      return pages.shift()!;
    };
    const all = await fetchOrders(fetcher, { sellerId: "s", start: "2026-06-01", end: "2026-06-10", limit: 2 });
    expect(all.map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(paths[1]).toBe("/orders?skip=2"); // followed the next path verbatim
  });

  it("stops when paging.next is null even on a full page", async () => {
    const fetcher = async (): Promise<XolaPage> => ({
      data: [order("a"), order("b")],
      paging: { next: null },
    });
    const all = await fetchOrders(fetcher, { sellerId: "s", start: "x", end: "y", limit: 2 });
    expect(all).toHaveLength(2);
  });

  it("throws rather than loop forever past maxItems", async () => {
    const fetcher = async (): Promise<XolaPage> => ({
      data: [order("a")],
      paging: { next: "/orders?skip=1" }, // never terminates
    });
    await expect(
      fetchOrders(fetcher, { sellerId: "s", start: "x", end: "y", limit: 1, maxItems: 3 }),
    ).rejects.toThrow(XolaError);
  });
});

describe("fetchEvents — bare-array feed", () => {
  it("returns the events array verbatim", async () => {
    const events = [xEvent("evt-1", RES_BREW2)];
    const all = await fetchEvents(async () => events, { sellerId: "s" });
    expect(all).toEqual(events);
  });

  it("returns [] when the response isn't an array", async () => {
    const all = await fetchEvents(async () => ({ data: [] }), { sellerId: "s" });
    expect(all).toEqual([]);
  });
});

describe("makeXolaFetcher — auth + retry", () => {
  const env: XolaEnv = {
    apiKey: "k-secret",
    sellerId: "s",
    base: "https://sandbox.xola.com/api",
    apiVersion: "2021-03-10",
  };
  const noSleep = async () => {};
  const okPage = () => new Response(JSON.stringify({ data: [], paging: { next: null } }), { status: 200 });

  it("sends X-API-Key + X-API-Version and resolves the JSON page", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => okPage());
    const fetcher = makeXolaFetcher(env, { fetchImpl: fetchImpl as unknown as typeof fetch, sleeper: noSleep });
    const page = await fetcher("/orders?seller=s");
    expect(page).toEqual({ data: [], paging: { next: null } });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://sandbox.xola.com/api/orders?seller=s");
    expect(init?.headers).toMatchObject({
      "X-API-Key": "k-secret",
      "X-API-Version": "2021-03-10",
    });
  });

  it("retries a 500 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(okPage());
    const fetcher = makeXolaFetcher(env, { fetchImpl: fetchImpl as unknown as typeof fetch, sleeper: noSleep });
    await expect(fetcher("/orders")).resolves.toEqual({ data: [], paging: { next: null } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 4xx — throws immediately", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404, statusText: "Not Found" }));
    const fetcher = makeXolaFetcher(env, { fetchImpl: fetchImpl as unknown as typeof fetch, sleeper: noSleep });
    await expect(fetcher("/orders")).rejects.toThrow(XolaError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after the attempt cap on persistent 5xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    const fetcher = makeXolaFetcher(env, { fetchImpl: fetchImpl as unknown as typeof fetch, sleeper: noSleep });
    await expect(fetcher("/orders")).rejects.toThrow(XolaError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
