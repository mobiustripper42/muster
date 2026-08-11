/**
 * The daily Xola report email — subject line and recipient parsing.
 *
 * These two pure functions are the whole reason this wrapper exists rather than a shell
 * pipe. The report script itself is proven and unchanged; what is new, and what can be
 * wrong in a way nobody notices, is the framing around it:
 *
 *  - a **subject that reads clean when the run failed** is worse than no email, because an
 *    operator who has learned "no news is good news" is now being actively told the wrong
 *    thing. Every failure path must be visible in the subject, which is the only part of
 *    the email a phone lock screen shows.
 *  - a **recipient list that silently resolves to nobody** sends a report to no one and
 *    exits 0. Cron logs nothing. That is the same silent-success shape.
 *
 * This runs under `db/**` in the vitest include (see vitest.config.ts) — `db/` scripts
 * carry guards, and a guard nobody tests is a guard nobody trusts.
 */
import { describe, it, expect } from "vitest";
import {
  parseRecipients,
  subjectFor,
  hoistSections,
  countUnaudited,
  urgentCounts,
} from "./xola-report-email.js";

describe("parseRecipients", () => {
  it("splits a comma list and trims whitespace", () => {
    expect(parseRecipients("a@x.com, b@y.com ,c@z.com")).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });

  it("drops empty entries from a trailing or doubled comma", () => {
    expect(parseRecipients("a@x.com,,b@y.com,")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("returns an empty list for undefined or whitespace — the caller must refuse to proceed", () => {
    expect(parseRecipients(undefined)).toEqual([]);
    expect(parseRecipients("   ")).toEqual([]);
  });
});

describe("countUnaudited", () => {
  /**
   * The distinction this function exists for, learned by getting it wrong: the report's
   * `N event(s) STILL have no boat` diagnostic counts EVENTS, and a cancelled trip's event is
   * routinely gone precisely because it was cancelled. Rows are the population that matters, and
   * `db/xola-report.ts:404` only raises the flag for a LIVE trip that escaped its capacity check.
   * Counting the diagnostic instead put a ⚠ on three cancelled trips, and a warning that fires
   * every morning for nothing is one nobody reads on the morning it counts.
   */
  it("counts rows carrying the flag, not the event diagnostic", () => {
    const stdout = [
      "2026-08-26  16:00  —       John Boris    700  12  0    cancelled",
      "2026-08-30  11:30  —       Real Person   200  13  1    UNAUDITED — no boat resolved",
    ].join("\n");
    const stderr = "  ! 3 event(s) STILL have no boat — those rows are UNAUDITED for capacity.";
    expect(countUnaudited(stdout, stderr)).toBe(1);
  });

  it("returns 0 when every boatless event belonged to a cancelled trip", () => {
    // Today's real shape: 3 events 404, all three trips cancelled, nothing escaped an audit.
    const stdout = [
      "2026-08-26  16:00  —  John Boris     700  12  0  cancelled",
      "2026-08-28  19:30  —  Simone Hoover  700  14  2  extra ×2 declared and paid; cancelled",
      "2026-09-06  13:30  —  Kyle Rechin    700  12  0  cancelled",
    ].join("\n");
    const stderr = "  ! 3 event(s) STILL have no boat — those rows are UNAUDITED for capacity.";
    expect(countUnaudited(stdout, stderr)).toBe(0);
  });
});

describe("hoistSections", () => {
  // Shape emitted by db/xola-report.ts `section()`: a blank line, "TITLE — N:", then rows
  // indented two spaces. Diagnostics ("Pulling…") come first in the stream, which is exactly
  // why the urgent sections have to be lifted out rather than left where they land.
  const STDERR = [
    "Pulling Xola orders, arrival 2026-08-11 … 2028-08-10",
    "  49 orders, 49 reservation lines",
    "  163 events for the boat join, spanning 2026-08-14 … 2026-09-06",
    "",
    "49 reservation line(s), 17 flagged.",
    "",
    "OVER CAPACITY — move the boat — 2:",
    "  2026-08-14 19:30  Brew 1  Coryonna gaines  13 pax  over",
    "  2026-08-15 11:30  Brew 1  Quinn Heimann    13 pax  over",
    "",
    "WOULD BE OVER if the declared guest shows — 1:",
    "  2026-08-16 17:30  Brew 2  Ali Kister       15 pax  would-be",
    "",
    "DECLARED ≠ PAID — money to chase — 1:",
    "  2026-08-17 11:30  Brew 1  Sam Reed         13 pax  mismatch",
    "",
  ].join("\n");

  it("lifts the two urgent sections to the top, in the order asked for", () => {
    const { hoisted } = hoistSections(STDERR);
    expect(hoisted.indexOf("OVER CAPACITY")).toBeGreaterThanOrEqual(0);
    expect(hoisted.indexOf("DECLARED ≠ PAID")).toBeGreaterThan(hoisted.indexOf("OVER CAPACITY"));
    expect(hoisted).toContain("Coryonna gaines");
    expect(hoisted).toContain("Sam Reed");
  });

  it("does not hoist the sections it wasn't asked for", () => {
    const { hoisted } = hoistSections(STDERR);
    expect(hoisted).not.toContain("WOULD BE OVER");
  });

  it("leaves everything else behind exactly once — nothing duplicated, nothing dropped", () => {
    const { hoisted, rest } = hoistSections(STDERR);
    expect(rest).toContain("WOULD BE OVER");
    expect(rest).toContain("Pulling Xola orders");
    expect(rest).not.toContain("Coryonna gaines"); // moved, not copied
    expect(rest).not.toContain("Sam Reed");
    // The diagnostics line the operator needs for issue #729 survives the surgery.
    expect(rest).toContain("163 events for the boat join");
  });

  it("returns empty hoisted text when neither section is present — a clean day", () => {
    const clean = "Pulling Xola orders\n\n49 reservation line(s), 0 flagged.\n";
    const { hoisted, rest } = hoistSections(clean);
    expect(hoisted).toBe("");
    expect(rest).toBe(clean);
  });
});

describe("subjectFor", () => {
  it("names the failure when the report exited non-zero — never a clean-looking subject", () => {
    const s = subjectFor({ ok: false, total: 0, over: 0, chase: 0 });
    expect(s).toMatch(/FAILED/);
    expect(s).not.toMatch(/nothing to act on/i);
  });

  it("names the failure even when the crashed run happened to parse a clean count", () => {
    // The dangerous case: the script printed its summary, THEN died. Counts look fine.
    // Exit status is the authority, not the numbers scraped out of the output.
    expect(subjectFor({ ok: false, total: 47, over: 0, chase: 0 })).toMatch(/FAILED/);
  });

  it("counts only what needs acting on — not every row carrying a flag", () => {
    // The failure this replaces: "17 flagged of 49" on a morning whose only real item was one
    // payment to chase. 15 of the 17 were extras that were paid for and fit the boat.
    expect(subjectFor({ ok: true, total: 49, over: 1, chase: 1 })).toBe(
      "Xola daily — 1 over capacity, 1 to chase",
    );
  });

  it("still names an over-capacity boat when there is no money to chase", () => {
    expect(subjectFor({ ok: true, total: 49, over: 2, chase: 0 })).toBe("Xola daily — 2 over capacity");
  });

  it("says nothing to act on explicitly, with the line count to prove it ran", () => {
    expect(subjectFor({ ok: true, total: 49, over: 0, chase: 0 })).toBe(
      "Xola daily — nothing to act on, 49 lines",
    );
  });

  it("distinguishes a quiet morning from one that returned no rows at all", () => {
    // Zero rows is not the same as zero to act on: a pull that silently returned nothing must
    // never read as quiet.
    expect(subjectFor({ ok: true, total: 0, over: 0, chase: 0 })).toMatch(/NO ROWS/);
  });
});

describe("urgentCounts", () => {
  it("reads the two section headers the operator acts on", () => {
    const stderr = [
      "49 reservation line(s), 17 flagged.",
      "",
      "OVER CAPACITY — move the boat — 2:",
      "  a row",
      "",
      "DECLARED ≠ PAID — money to chase — 1:",
      "  another row",
      "",
      "EXTRA GUESTS, consistent and within capacity — 15:",
      "  fifteen benign rows",
    ].join("\n");
    expect(urgentCounts(stderr)).toEqual({ over: 2, chase: 1 });
  });

  it("returns zeroes when a section is absent — the report omits empty sections entirely", () => {
    expect(urgentCounts("49 reservation line(s), 0 flagged.")).toEqual({ over: 0, chase: 0 });
  });

  it("ignores the benign extras section, however large it is", () => {
    const stderr = "EXTRA GUESTS, consistent and within capacity — 40:\n  rows";
    expect(urgentCounts(stderr)).toEqual({ over: 0, chase: 0 });
  });
});
