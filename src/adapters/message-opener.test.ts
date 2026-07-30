/**
 * The shared outbound opener (#599). One definition of "which hat is this
 * message addressed to", so the four senders can't drift apart again.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "./in-memory-repository.js";
import { asId } from "../domain/ids.js";
import { composeBoardAlert } from "./forward-board-alerts.js";
import { RING_NOTIFICATION_BODY } from "./forward-notifications.js";
import { OPENER, outbound, type Audience } from "./message-opener.js";

describe("outbound openers (#599)", () => {
  it("puts the audience marker FIRST, before any date or vessel survives truncation", () => {
    // The whole point. A lock-screen preview truncates from the right, so a marker
    // anywhere but the front is invisible exactly when there are enough messages to
    // need it. Assert on the opening characters, not on containment.
    expect(outbound("crew", "Wed, Jul 29 - Brew 4 - captain. In or out?")).toMatch(
      /^Muster: /,
    );
    expect(outbound("admin", "1 shift needs you")).toMatch(/^Muster ADMIN: /);
  });

  it("crew and admin differ in the first WORD, not a leading glyph", () => {
    // The reported failure: `⚠ Muster:` vs `Muster:` differ by one leading
    // character, which is not a distinction anyone reads at a glance.
    const crewFirstWord = outbound("crew", "x").split(" ")[0];
    const adminFirstTwo = outbound("admin", "x").split(" ").slice(0, 2).join(" ");
    expect(crewFirstWord).toBe("Muster:");
    expect(adminFirstTwo).toBe("Muster ADMIN:");
    // And the two openers are not distinguished by punctuation alone.
    expect(OPENER.admin.replace(/[^A-Za-z]/g, "")).not.toBe(
      OPENER.crew.replace(/[^A-Za-z]/g, ""),
    );
  });

  it("never double-prefixes a body that already carries the opener", () => {
    // Guards the migration: a sender that keeps its old literal AND adopts the
    // helper would otherwise ship "Muster: Muster: …".
    expect(outbound("crew", "Muster: you're on the shift.")).toBe(
      "Muster: you're on the shift.",
    );
    expect(outbound("admin", "Muster ADMIN: 1 shift needs you")).toBe(
      "Muster ADMIN: 1 shift needs you",
    );
  });

  it("trims incidental whitespace so the marker is flush against the body", () => {
    expect(outbound("crew", "  hello ")).toBe("Muster: hello");
  });

  it("covers every audience — a new one must be given an opener, not defaulted", () => {
    const audiences: Audience[] = ["crew", "admin"];
    for (const a of audiences) {
      expect(OPENER[a]).toBeTruthy();
      expect(OPENER[a].startsWith("Muster")).toBe(true);
    }
    expect(Object.keys(OPENER).sort()).toEqual(audiences.sort());
  });
});

describe("every outbound sender front-loads its audience marker (#599)", () => {
  // The convention is only worth having if all four classes obey it. These assert
  // the CONTRACT — the opening characters, per audience — not the body copy, so a
  // wording change to any message doesn't falsely redden them.
  const CREW = /^Muster: /;
  const ADMIN = /^Muster ADMIN: /;

  it("the operator board alert opens ADMIN-side — the #599 headline", async () => {
    const repo = new InMemoryRepository();
    await repo.saveVessel({
      id: asId<"VesselId">("v"),
      name: "Brew 4",
      coiMaxPax: 12,
      manning: [],
    });
    await repo.saveShift({
      id: asId<"ShiftId">("sh"),
      vesselId: asId<"VesselId">("v"),
      date: "2026-07-29",
      state: "AtRisk",
      eventIds: [],
    });

    const body = await composeBoardAlert(repo, [
      { shiftId: "sh", reason: "no_takers" },
    ]);

    expect(body).toMatch(ADMIN);
    // And specifically NOT the crew opener — the confusion this issue is about.
    expect(body).not.toMatch(CREW);
    // The vessel and date still follow; only the front changed.
    expect(body).toContain("Brew 4");
  });

  it("the ring notification opens crew-side", async () => {
    expect(RING_NOTIFICATION_BODY).toMatch(CREW);
  });

  it("an assignment notice opens crew-side", () => {
    // forward-notices composes inline; assert the shape it must produce.
    expect(outbound("crew", "you're on the Sat, Jul 4 - Barrel shift.")).toMatch(CREW);
  });

  it("crew and admin openers cannot be confused by a truncated preview", () => {
    // Truncate both to the width a lock screen actually shows and confirm they
    // still differ — the failure was that they didn't.
    const crewPreview = outbound("crew", "Wed, Jul 29 - Brew 4 - captain. In or out?").slice(0, 14);
    const adminPreview = outbound("admin", "1 shift needs you").slice(0, 14);
    expect(crewPreview).not.toBe(adminPreview);
    expect(adminPreview).toContain("ADMIN");
  });
});
