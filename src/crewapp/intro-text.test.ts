/**
 * Guest intro text (#345) — the preloaded message body. Locks the wording, the
 * first-name-only rule, and the empty-name fallback.
 */

import { describe, expect, it } from "vitest";
import { buildIntroText, firstName } from "./intro-text.js";

const LOC = "Canal Basin Park near Flatiron Cafe";
const MAP = "https://maps.app.goo.gl/A2vG7Q9LjKdZJpod9";

describe("firstName", () => {
  it("takes the first token", () => {
    expect(firstName("Eric Stoffer")).toBe("Eric");
    expect(firstName("  Quint  ")).toBe("Quint");
  });
  it("is empty for null/blank", () => {
    expect(firstName(null)).toBe("");
    expect(firstName("   ")).toBe("");
  });
});

describe("buildIntroText", () => {
  it("interpolates sender first name, tenant, time, location, and map link", () => {
    expect(
      buildIntroText({ senderName: "Eric Stoffer", tenantName: "BrewBoat", departureLabel: "11:30 AM", location: LOC, mapUrl: MAP }),
    ).toBe(
      "Hi, this is Eric with BrewBoat — I'll be taking you out at 11:30 AM today. " +
        `Please confirm the pickup location: ${LOC}. ${MAP}`,
    );
  });

  it("drops the name cleanly when the sender name is empty", () => {
    const body = buildIntroText({ senderName: "", tenantName: "BrewBoat", departureLabel: "5:45 PM", location: LOC, mapUrl: MAP });
    expect(body).toContain("Hi, this is BrewBoat — I'll be taking you out at 5:45 PM today.");
    expect(body).not.toContain("this is  with"); // no empty gap
  });
});
