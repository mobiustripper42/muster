import { describe, expect, it } from "vitest";
import { planGustoImport, type GustoMapEntry } from "./gusto-import.js";

const entry = (name: string, employeeId: string): GustoMapEntry => {
  const [firstName, ...rest] = name.split(" ");
  return { name, firstName: firstName!, lastName: rest.join(" "), title: "First Mate", employeeId };
};

describe("planGustoImport", () => {
  it("matches crew to entries loosely by name (case/space-insensitive)", () => {
    const plan = planGustoImport(
      [{ id: "crew-1", name: "Sarah  Angelone" }, { id: "crew-2", name: "kevin berger" }],
      [entry("Sarah Angelone", "3e4c22"), entry("Kevin Berger", "95237c")],
    );
    expect(plan.matched).toHaveLength(2);
    expect(plan.matched.find((m) => m.crewId === "crew-1")?.gusto.employeeId).toBe("3e4c22");
    expect(plan.crewWithoutEntry).toEqual([]);
    expect(plan.entriesWithoutCrew).toEqual([]);
  });

  it("surfaces crew with no entry and entries with no crew (roster drift), applies neither", () => {
    const plan = planGustoImport(
      [{ id: "crew-1", name: "Sarah Angelone" }, { id: "crew-2", name: "New Hire" }],
      [entry("Sarah Angelone", "3e4c22"), entry("Departed Guide", "ffffff")],
    );
    expect(plan.matched.map((m) => m.crewName)).toEqual(["Sarah Angelone"]);
    expect(plan.crewWithoutEntry).toEqual(["New Hire"]);
    expect(plan.entriesWithoutCrew).toEqual(["Departed Guide"]);
  });

  it("refuses an ambiguous name (a wrong employeeId is worse than an unmapped crew)", () => {
    const plan = planGustoImport(
      [{ id: "crew-1", name: "John Smith" }, { id: "crew-2", name: "john smith" }],
      [entry("John Smith", "aaa111")],
    );
    expect(plan.matched).toEqual([]);
    expect(plan.ambiguous).toHaveLength(1);
    expect(plan.entriesWithoutCrew).toEqual([]); // the entry isn't "unmatched", it's ambiguous
  });
});
