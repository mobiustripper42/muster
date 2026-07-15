/**
 * The recipient union guard (DEC-122).
 */
import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import { requireCrewId, type Recipient } from "./channel.js";

describe("requireCrewId", () => {
  it("returns the id for a crew recipient", () => {
    const crew: Recipient = { crewMemberId: asId<"CrewMemberId">("cm-1") };
    expect(requireCrewId(crew)).toBe("cm-1");
  });

  it("throws LOUD for a guest recipient (never a silent undefined into a minted link)", () => {
    const guest: Recipient = { email: "guest@example.com", phone: "+15550001111" };
    expect(() => requireCrewId(guest)).toThrow(/crewMemberId/);
  });
});
