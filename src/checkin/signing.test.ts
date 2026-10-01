/**
 * The signing rules (Phase 18.4, issue #1118) — what one submitted waiver form becomes, and what
 * it is refused for. The page is `app/w/[code]`; every rule it relies on is here.
 *
 * Clock: Saturday 2026-10-10 in New York. Age of majority 18 unless a test says otherwise.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { WaiverTemplate } from "./entities.js";
import {
  birthYearOptions,
  buildSigning,
  groupCoverage,
  loadSigningScene,
  MAX_CHILDREN,
  partyChoices,
  partyFor,
  signAndSave,
  type SigningContext,
  type SigningForm,
} from "./signing.js";

const EVENT = asId<"EventId">("evt-sat-3pm");
const RESV = asId<"ReservationId">("resv-smith");
const NOW = "2026-10-10T17:30:00.000Z";

const TEMPLATE: WaiverTemplate = {
  id: asId<"WaiverTemplateId">("wt-1"),
  version: "brewboat-2026-v1",
  body: "I accept the risks.",
  effectiveFrom: "2026-09-01T04:00:00.000Z",
  postedAt: "2026-09-01T04:00:00.000Z",
  postedBy: "crew-eric",
};

function ctx(over: Partial<SigningContext> = {}): SigningContext {
  let n = 0;
  return {
    eventId: EVENT,
    template: TEMPLATE,
    ageOfMajority: 18,
    today: "2026-10-10",
    now: NOW,
    bookedReservationIds: [RESV],
    ip: "203.0.113.9",
    userAgent: "Mozilla/5.0 (iPhone)",
    newId: () => `guest-${++n}`,
    ...over,
  };
}

const dob = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
};

function form(over: Partial<SigningForm> = {}, adult: Partial<SigningForm["adult"]> = {}): SigningForm {
  return {
    path: "me",
    reservationId: RESV,
    shownTemplateId: "wt-1",
    children: [],
    consent: true,
    ...over,
    adult: {
      name: "Fred Kowalski",
      legalNameConfirmed: true,
      dob: dob("1980-04-02"),
      email: "fred@example.com",
      phone: "",
      ...adult,
    },
  };
}

const kid = (name: string, iso: string) => ({ name, dob: dob(iso) });

describe("buildSigning — the rows one signing writes", () => {
  it("an adult signing for themselves is one signed row, stamped with the waiver version and the device", () => {
    const r = buildSigning(form({}, { email: "  Fred@Example.COM ", phone: "(216) 555-0148" }), ctx());
    expect(r).toEqual({
      ok: true,
      rows: [
        {
          id: "guest-1",
          eventId: EVENT,
          reservationId: RESV,
          name: "Fred Kowalski",
          email: "fred@example.com",
          phone: "+12165550148",
          dob: "1980-04-02",
          isMinor: false,
          signedAt: NOW,
          waiverTemplateId: "wt-1",
          signatureName: "Fred Kowalski",
          signedIp: "203.0.113.9",
          signedUserAgent: "Mozilla/5.0 (iPhone)",
          source: "self",
          createdAt: NOW,
        },
      ],
    });
  });

  it("a walk-up's row belongs to the departure and no booking", () => {
    const r = buildSigning(form({ reservationId: null }), ctx());
    expect(r.ok && r.rows[0]).not.toHaveProperty("reservationId");
    expect(r.ok && r.rows[0]?.eventId).toBe(EVENT);
  });

  it("leaves out what is not known — no phone, no device details", () => {
    const r = buildSigning(form(), ctx({ ip: undefined, userAgent: undefined }));
    expect(r.ok && r.rows[0]).not.toHaveProperty("phone");
    expect(r.ok && r.rows[0]).not.toHaveProperty("signedIp");
    expect(r.ok && r.rows[0]).not.toHaveProperty("signedUserAgent");
  });

  it("Me + my kids: the adult signs, each child points at them, unsigned and covered — adult first", () => {
    const r = buildSigning(
      form({ path: "kids", children: [kid("Kyle Kowalski", "2014-06-20"), kid("Amy Kowalski", "2019-01-05")] }),
      ctx(),
    );
    if (!r.ok) throw new Error(r.code);
    expect(r.rows.map((g) => [g.id, g.name, g.isMinor, g.guardianGuestId, g.signedAt])).toEqual([
      ["guest-1", "Fred Kowalski", false, undefined, NOW],
      ["guest-2", "Kyle Kowalski", true, "guest-1", undefined],
      ["guest-3", "Amy Kowalski", true, "guest-1", undefined],
    ]);
    expect(r.rows[1]).toEqual({
      id: "guest-2",
      eventId: EVENT,
      reservationId: RESV,
      name: "Kyle Kowalski",
      dob: "2014-06-20",
      isMinor: true,
      guardianGuestId: "guest-1",
      source: "self",
      createdAt: NOW,
    });
  });

  it("A child (under 18) writes exactly what Me + my kids does — the parent always sails (operator, 2026-09-30)", () => {
    const kids = [kid("Kyle Kowalski", "2014-06-20")];
    const a = buildSigning(form({ path: "child", children: kids }), ctx());
    const b = buildSigning(form({ path: "kids", children: kids }), ctx());
    expect(a).toEqual(b);
  });

  it("never merges — a second signing with the same email and phone is new rows", () => {
    const c = ctx();
    const first = buildSigning(form({}, { phone: "2165550148" }), c);
    const second = buildSigning(form({}, { name: "Dana Kowalski", phone: "2165550148" }), c);
    expect(first.ok && second.ok && first.rows[0]!.id !== second.rows[0]!.id).toBe(true);
  });

  it("tidies a name: trimmed, inner spaces collapsed", () => {
    const r = buildSigning(form({}, { name: "  Fred   Kowalski " }), ctx());
    expect(r.ok && [r.rows[0]?.name, r.rows[0]?.signatureName]).toEqual(["Fred Kowalski", "Fred Kowalski"]);
  });
});

describe("buildSigning — ages, against the age of majority on the day of signing (boat time)", () => {
  it("an adult who turns 18 today may sign; one who turns 18 tomorrow may not", () => {
    expect(buildSigning(form({}, { dob: dob("2008-10-10") }), ctx()).ok).toBe(true);
    expect(buildSigning(form({}, { dob: dob("2008-10-11") }), ctx())).toEqual({ ok: false, code: "adult_too_young" });
  });

  it("a child who turns 18 today is no longer a child; one a day younger is", () => {
    const withKid = (iso: string) => form({ path: "kids", children: [kid("Kyle Kowalski", iso)] });
    expect(buildSigning(withKid("2008-10-10"), ctx())).toEqual({ ok: false, code: "child_too_old" });
    const r = buildSigning(withKid("2008-10-11"), ctx());
    expect(r.ok && r.rows[1]?.isMinor).toBe(true);
  });

  it("follows the setting, not a hard-coded 18", () => {
    const c = ctx({ ageOfMajority: 21 });
    expect(buildSigning(form({}, { dob: dob("2006-01-01") }), c)).toEqual({ ok: false, code: "adult_too_young" });
    const r = buildSigning(form({ path: "kids", children: [kid("Sam Kowalski", "2006-01-01")] }), c);
    expect(r.ok && r.rows[1]?.isMinor).toBe(true);
  });

  it("a 29 February birthday is a year older on 1 March, not on 28 February", () => {
    const c = (today: string) => ctx({ today });
    expect(buildSigning(form({}, { dob: dob("2008-02-29") }), c("2026-02-28"))).toEqual({
      ok: false,
      code: "adult_too_young",
    });
    expect(buildSigning(form({}, { dob: dob("2008-02-29") }), c("2026-03-01")).ok).toBe(true);
  });

  it.each([
    ["a date that does not exist", { year: 1980, month: 2, day: 30 }],
    ["a blank select", { year: Number.NaN, month: 4, day: 2 }],
    ["a birthday in the future", { year: 2027, month: 1, day: 1 }],
    ["a year beyond the list", { year: 1880, month: 1, day: 1 }],
  ])("refuses %s as the adult's date of birth", (_label, d) => {
    expect(buildSigning(form({}, { dob: d }), ctx())).toEqual({ ok: false, code: "bad_dob" });
  });

  it("refuses a child's date of birth that does not exist", () => {
    const r = buildSigning(form({ path: "kids", children: [{ name: "Kyle", dob: { year: 2014, month: 13, day: 1 } }] }), ctx());
    expect(r).toEqual({ ok: false, code: "bad_child_dob" });
  });
});

describe("buildSigning — refusals", () => {
  it("no waiver posted: nothing can be signed", () => {
    expect(buildSigning(form(), ctx({ template: null }))).toEqual({ ok: false, code: "no_waiver" });
  });

  it("the waiver changed after the form was shown — the guest must read the new words first", () => {
    // The row records the version the guest SAW, never one posted while they were typing.
    expect(buildSigning(form({ shownTemplateId: "wt-0" }), ctx())).toEqual({ ok: false, code: "waiver_changed" });
    expect(buildSigning(form({ shownTemplateId: "" }), ctx())).toEqual({ ok: false, code: "waiver_changed" });
  });

  it("a booking that is not on this departure", () => {
    expect(buildSigning(form({ reservationId: asId<"ReservationId">("resv-elsewhere") }), ctx())).toEqual({
      ok: false,
      code: "bad_party",
    });
  });

  it(`kids: at least one on a kids path, none on Myself, and never more than ${MAX_CHILDREN}`, () => {
    const many = Array.from({ length: MAX_CHILDREN + 1 }, (_, i) => kid(`Kid ${i}`, "2015-01-01"));
    expect(buildSigning(form({ path: "kids", children: [] }), ctx())).toEqual({ ok: false, code: "bad_kids_count" });
    expect(buildSigning(form({ path: "child", children: many }), ctx())).toEqual({ ok: false, code: "bad_kids_count" });
    expect(buildSigning(form({ path: "me", children: [kid("Kyle", "2014-06-20")] }), ctx())).toEqual({
      ok: false,
      code: "bad_kids_count",
    });
    expect(buildSigning(form({ path: "kids", children: many.slice(0, MAX_CHILDREN) }), ctx()).ok).toBe(true);
  });

  it.each([
    ["a blank name", { name: "   " }, "bad_name"],
    ["a name over 100 characters", { name: "x".repeat(101) }, "bad_name"],
    ["the legal-name box unticked", { legalNameConfirmed: false }, "legal_name_unconfirmed"],
    ["no email", { email: " " }, "bad_email"],
    ["an email with no domain", { email: "fred@nowhere" }, "bad_email"],
    ["a phone that cannot be dialled", { phone: "555-01" }, "bad_phone"],
  ])("refuses %s", (_label, adult, code) => {
    expect(buildSigning(form({}, adult as Partial<SigningForm["adult"]>), ctx())).toEqual({ ok: false, code });
  });

  it("refuses a child with no name", () => {
    expect(buildSigning(form({ path: "kids", children: [kid(" ", "2014-06-20")] }), ctx())).toEqual({
      ok: false,
      code: "bad_child_name",
    });
  });

  it("refuses without the consent box", () => {
    expect(buildSigning(form({ consent: false }), ctx())).toEqual({ ok: false, code: "consent_required" });
  });
});

describe("signAndSave", () => {
  it("writes the rows together and hands back the signer", async () => {
    const repo = new InMemoryRepository();
    const r = await signAndSave(repo, form({ path: "kids", children: [kid("Kyle Kowalski", "2014-06-20")] }), ctx());
    expect(r.ok && r.signer.name).toBe("Fred Kowalski");
    expect((await repo.listGuestsForEvent(EVENT)).map((g) => g.name).sort()).toEqual(["Fred Kowalski", "Kyle Kowalski"]);
  });

  it("writes nothing when refused", async () => {
    const repo = new InMemoryRepository();
    expect(await signAndSave(repo, form({ consent: false }), ctx())).toEqual({ ok: false, code: "consent_required" });
    expect(await repo.listGuestsForEvent(EVENT)).toEqual([]);
  });
});

describe("birthYearOptions — the year select, bounded by the path", () => {
  it("an adult's list starts at the age of majority and goes back 110 years, newest first", () => {
    const years = birthYearOptions("adult", "2026-10-10", 18);
    expect(years[0]).toBe(2008);
    expect(years.at(-1)).toBe(1916);
    expect(years).toEqual([...years].sort((a, b) => b - a));
  });

  it("a child's list runs from this year back to the age of majority — the boundary year is in both", () => {
    expect(birthYearOptions("child", "2026-10-10", 18)).toEqual(
      Array.from({ length: 19 }, (_, i) => 2026 - i),
    );
  });

  it("follows the setting", () => {
    expect(birthYearOptions("adult", "2026-10-10", 21)[0]).toBe(2005);
  });
});

describe("groupCoverage — 'Your group: 14 of 16 signed'", () => {
  it("counts every row on the booking — a guarded child is covered", () => {
    expect(groupCoverage(16, 14, 16)).toEqual({ covered: 14, of: 16, remaining: 2 });
  });

  it("never shows more signed than the party, however many duplicates", () => {
    expect(groupCoverage(4, 6, 16)).toEqual({ covered: 4, of: 4, remaining: 0 });
  });

  it("never shows a number above the boat's passenger limit (the COI rule)", () => {
    expect(groupCoverage(20, 18, 16)).toEqual({ covered: 16, of: 16, remaining: 0 });
  });
});

describe("loadSigningScene and partyFor — what the page and the sign action both read", () => {
  const vessel = { id: asId<"VesselId">("vessel-hops"), name: "Hops", coiMaxPax: 12, manning: [] };
  const resv = (id: string, status: Reservation["status"] = "booked"): Reservation => ({
    id: asId<"ReservationId">(id),
    eventId: EVENT,
    customerName: `Carol ${id}`,
    partySize: 4,
    status,
    source: "muster",
  });

  async function world() {
    const repo = new InMemoryRepository();
    await repo.saveVessel(vessel);
    await repo.saveEvent({ id: EVENT, vesselId: vessel.id, date: "2026-10-10", time: "15:00", capacity: 16, status: "scheduled", source: "muster" });
    return repo;
  }

  it("reads the booked parties, the waiver in force, the age of majority and the boat's limit", async () => {
    const repo = await world();
    await repo.saveReservation(resv("r1"));
    await repo.saveReservation(resv("r2", "cancelled"));
    await repo.postWaiverTemplate(TEMPLATE);
    await repo.setCheckInConfig({ ageOfMajority: 21 }, NOW);
    const scene = await loadSigningScene(repo, EVENT, NOW);
    expect(scene.reservations.map((r) => r.id)).toEqual(["r1"]);
    expect(scene.template?.id).toBe("wt-1");
    expect(scene.ageOfMajority).toBe(21);
    expect(scene.coiMaxPax).toBe(12);
  });

  it("has no template before one is posted, and none that only takes effect later", async () => {
    const repo = await world();
    await repo.postWaiverTemplate({ ...TEMPLATE, effectiveFrom: "2027-01-01T05:00:00.000Z" });
    expect((await loadSigningScene(repo, EVENT, NOW)).template).toBeNull();
  });

  it("partyFor: one booking is that booking, none is a walk-up, several need the guest to choose", () => {
    const one = [resv("r1")];
    const two = [resv("r1"), resv("r2")];
    expect(partyFor([], undefined)).toBeNull();
    expect(partyFor(one, undefined)).toBe("r1");
    expect(partyFor(two, undefined)).toBe("choose");
    expect(partyFor(two, "r2")).toBe("r2");
    expect(partyFor(two, "walkup")).toBeNull();
    expect(partyFor(two, "resv-elsewhere")).toBe("choose");
    expect(partyFor(one, "walkup")).toBeNull();
  });

  it("partyFor: a party the guest picked that is no longer booked means choose again — never a silent swap", () => {
    // Nowak was picked, then cancelled, leaving only Smith: the guest is not quietly moved into
    // Smith's group (code review, 18.4). They pick again, from Smith or walk-up.
    expect(partyFor([resv("r1")], "r2")).toBe("choose");
    expect(partyFor([], "r2")).toBeNull();
  });
});

describe("partyChoices — 'Who are you here with?'", () => {
  const resv = (id: string, customerName: string, partySize: number, status: Reservation["status"] = "booked"): Reservation => ({
    id: asId<"ReservationId">(id),
    eventId: EVENT,
    customerName,
    partySize,
    status,
    source: "muster",
  });

  it("lists booked parties by surname only, alphabetically", () => {
    expect(
      partyChoices([resv("r1", "Ana Reyes", 6), resv("r2", "Carol Smith", 4), resv("r3", "Piotr Nowak", 2), resv("r4", "Gone Away", 3, "cancelled")]),
    ).toEqual([
      { reservationId: "r3", surname: "Nowak", partySize: 2 },
      { reservationId: "r1", surname: "Reyes", partySize: 6 },
      { reservationId: "r2", surname: "Smith", partySize: 4 },
    ]);
  });

  it("a one-word or blank name still gets a label", () => {
    expect(partyChoices([resv("r1", "Cher", 2), resv("r2", "  ", 2)]).map((p) => p.surname)).toEqual(["Cher", "Guest"]);
  });
});
