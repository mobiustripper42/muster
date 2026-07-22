import { describe, expect, it } from "vitest";
import type { IntegrityReport, IntegrityViolation } from "./integrity.js";
import { buildIntegrityView } from "./integrity-view.js";

function violation(entity: string, id: string): IntegrityViolation {
  return { entity, id, ref: `${entity}Ref`, missingId: `missing-${id}` };
}

function report(overrides: Partial<IntegrityReport> = {}): IntegrityReport {
  return {
    ok: true,
    violations: [],
    scanned: { crew: 3, seats: 10, shifts: 2 },
    ...overrides,
  };
}

describe("buildIntegrityView", () => {
  it("reports a clean spine with the scanned counts intact", () => {
    const view = buildIntegrityView(report());

    expect(view.ok).toBe(true);
    expect(view.total).toBe(0);
    expect(view.groups).toEqual([]);
    // The counts are what makes "clean" distinguishable from "didn't run".
    expect(view.scanned).toEqual([
      { entity: "crew", rows: 3 },
      { entity: "seats", rows: 10 },
      { entity: "shifts", rows: 2 },
    ]);
    expect(view.scannedTotal).toBe(15);
  });

  it("groups violations by entity and counts each group", () => {
    const view = buildIntegrityView(
      report({
        ok: false,
        violations: [
          violation("seat", "s1"),
          violation("ask", "a1"),
          violation("seat", "s2"),
        ],
      }),
    );

    expect(view.ok).toBe(false);
    expect(view.total).toBe(3);
    expect(view.groups.map((g) => [g.entity, g.count])).toEqual([
      ["seat", 2],
      ["ask", 1],
    ]);
    expect(view.groups[0]?.violations.map((v) => v.id)).toEqual(["s1", "s2"]);
  });

  it("orders the biggest breakage first — that's the backfill worth chasing", () => {
    const view = buildIntegrityView(
      report({
        ok: false,
        violations: [
          violation("ask", "a1"),
          ...["s1", "s2", "s3"].map((id) => violation("seat", id)),
          violation("event", "e1"),
          violation("event", "e2"),
        ],
      }),
    );

    expect(view.groups.map((g) => g.entity)).toEqual(["seat", "event", "ask"]);
  });

  it("breaks count ties alphabetically so the render is stable across runs", () => {
    const view = buildIntegrityView(
      report({
        ok: false,
        violations: [
          violation("shift", "s1"),
          violation("ask", "a1"),
          violation("event", "e1"),
        ],
      }),
    );

    expect(view.groups.map((g) => g.entity)).toEqual(["ask", "event", "shift"]);
  });

  it("preserves every violation field the page renders", () => {
    const view = buildIntegrityView(
      report({
        ok: false,
        violations: [
          { entity: "seat", id: "seat-9", ref: "shiftId", missingId: "shift-gone" },
        ],
      }),
    );

    expect(view.groups[0]?.violations[0]).toEqual({
      entity: "seat",
      id: "seat-9",
      ref: "shiftId",
      missingId: "shift-gone",
    });
  });

  it("trusts the report's verdict rather than re-deriving it from the list", () => {
    // A report claiming ok with violations present is a contradiction the view
    // must not paper over — it surfaces both, and the page leads with `ok`.
    const view = buildIntegrityView(
      report({ ok: true, violations: [violation("seat", "s1")] }),
    );

    expect(view.ok).toBe(true);
    expect(view.total).toBe(1);
  });

  it("survives an empty scan set without dividing by zero or NaN-ing the total", () => {
    const view = buildIntegrityView(report({ scanned: {} }));

    expect(view.scanned).toEqual([]);
    expect(view.scannedTotal).toBe(0);
  });
});
