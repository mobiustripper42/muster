// Tests for the context-doc path checker (#593 fallout).
//
// The value of this suite is almost entirely in the NEGATIVE cases. A path checker that finds
// nothing looks identical whether it is working or whether its matcher stopped matching — the
// #589 failure. So the cases below pin what it deliberately ignores as hard as what it catches,
// and the last block asserts the real docs are clean.

import { describe, expect, it } from "vitest";
import { check, isClaim } from "./check-context.mjs";

describe("isClaim — what counts as a claim about this repo", () => {
  it("accepts a path rooted in a real top-level directory", () => {
    expect(isClaim("src/adapters/twilio-channel.ts")).toBe(true);
    expect(isClaim("app/lib/channel.ts")).toBe(true);
    expect(isClaim("docs/decisions/DEC-143-x.md")).toBe(true);
  });

  it("ignores a bare filename, which is shorthand rather than a location", () => {
    // `layout.tsx`, `DEPLOY.md`, `login-code.ts` all appear this way in the docs today.
    expect(isClaim("layout.tsx")).toBe(false);
    expect(isClaim("DEPLOY.md")).toBe(false);
  });

  it("ignores git refs, which are not paths", () => {
    expect(isClaim("origin/production")).toBe(false);
    expect(isClaim("feature/reservations")).toBe(false);
  });

  it("ignores seeds-repo paths, which correctly do not exist in this repo", () => {
    expect(isClaim("dev/claude/templates/VersionTag.tsx")).toBe(false);
  });

  it("ignores an explicit <placeholder>, since Next route params are real dirs", () => {
    // `components/<feature>/` describes a shape; `app/(crew)/crew/shift/[shiftId]` is a real
    // directory, so brackets can't be the placeholder marker — angle brackets are.
    expect(isClaim("components/<feature>/")).toBe(false);
    expect(isClaim("app/(crew)/crew/shift/[shiftId]")).toBe(true);
  });

  it("ignores a tsconfig alias", () => {
    expect(isClaim("@core/*")).toBe(false);
  });
});

describe("check", () => {
  it("passes on the real docs — every cited path and pattern resolves", () => {
    expect(check()).toEqual([]);
  });

  it("catches a dead path, a dead glob, and a dead brace expansion", () => {
    // The negative control. Without it, a matcher that quietly stopped matching would leave
    // this suite green and the check permanently inert.
    const failures = check([
      { path: "fixture.md", text: "See `src/adapters/no-such-channel.ts` and `src/adapters/*-nope.ts`." },
      { path: "fixture2.md", text: "Surfaces: `app/(crew)/crew/{ask,nowhere}/page.tsx`." },
    ]);
    expect(failures).toHaveLength(3);
    expect(failures[0]).toMatch(/no-such-channel\.ts.*does not exist/);
    expect(failures[1]).toMatch(/\*-nope\.ts.*does not exist/);
    expect(failures[2]).toMatch(/nowhere.*does not exist/);
  });

  it("resolves a real glob and a real brace expansion", () => {
    expect(
      check([{ path: "fixture.md", text: "`src/adapters/*-channel.ts` and `scripts/{check,gen}-decisions*.mjs`" }]),
    ).toEqual([]);
  });

  it("reports the line number, so a failure is one click from the claim", () => {
    const failures = check([{ path: "fixture.md", text: "line one\nline two\n`src/nope/gone.ts`" }]);
    expect(failures[0]).toContain("fixture.md:3");
  });
});
