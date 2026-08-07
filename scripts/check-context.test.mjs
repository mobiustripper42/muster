// Tests for the context-doc path checker.
//
// The value of this suite is almost entirely in the NEGATIVE cases. A path checker that finds
// nothing looks identical whether it is working or whether its matcher stopped matching — the
// #589 failure. So the cases below pin what it deliberately ignores as hard as what it catches,
// and the last block asserts the real docs are clean.

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { check, expandBraces, isClaim } from "./check-context.mjs";

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

describe("expandBraces", () => {
  it("expands a brace list, including the empty alternative", () => {
    expect(expandBraces("crew/{,open,calendar}/page.tsx")).toEqual([
      "crew//page.tsx",
      "crew/open/page.tsx",
      "crew/calendar/page.tsx",
    ]);
  });

  it("expands nested groups and leaves a brace-free pattern alone", () => {
    expect(expandBraces("{a,b}/{x,y}")).toEqual(["a/x", "a/y", "b/x", "b/y"]);
    expect(expandBraces("src/*.ts")).toEqual(["src/*.ts"]);
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

  it("resolves a glob under a Next dynamic segment, whose brackets are not a character class", () => {
    // `globSync` reads `[shiftId]` as "one character from s,h,i,f,t,I,d" and matches nothing, so
    // every dynamic route in an App Router project was uncitable in the two always-loaded docs —
    // the check reported the doc as wrong for being right. `isClaim` above already asserts these
    // are real directories, which is what made the pair contradict each other.
    expect(check([{ path: "f.md", text: "`app/(crew)/crew/shift/[shiftId]/**`" }])).toEqual([]);
    // Still a negative control: escaping must not turn every bracket pattern into a pass.
    expect(check([{ path: "f.md", text: "`app/(crew)/crew/nope/[shiftId]/**`" }])[0]).toMatch(/does not exist/);
  });

  it("resolves a real glob and a real brace expansion", () => {
    expect(
      check([{ path: "fixture.md", text: "`src/adapters/*-channel.ts` and `scripts/{check,gen}-decisions*.mjs`" }]),
    ).toEqual([]);
  });

  it("checks a pointer written as the `ls <path>` command a reader would run", () => {
    // The first version's no-whitespace rule made every `ls `-prefixed span invisible — including
    // the two authoritative-list pointers in CLAUDE-context.md and the one this script's own
    // comment holds up as the worked example. The check was blind to exactly the pattern it
    // exists to encourage, and the docs asserted it was covered.
    expect(check([{ path: "f.md", text: "list: `ls src/adapters/*-channel.ts`" }])).toEqual([]);
    expect(check([{ path: "f.md", text: "list: `ls src/adapters/*-nope.ts`" }])[0]).toMatch(/does not exist/);
  });

  it("reads a span the author escaped for a shell paste", () => {
    // `app/\(crew\)/crew/` is written backslashed so it can be pasted into bash. Those slashes
    // are for the shell, not for a filesystem lookup.
    expect(check([{ path: "f.md", text: "`ls app/\\(crew\\)/crew/`" }])).toEqual([]);
  });

  it("never invokes a shell, so a doc cannot execute anything", () => {
    // Review demonstrated real command execution against the first version, which interpolated
    // the span into `bash -lc "ls ${pattern}"`. This runs in `verify` on every dev machine and in
    // CI, and the premise of this whole check is that docs get less scrutiny than code.
    const payload = "src/*;touch$IFS/tmp/check-context-should-not-exist";
    expect(check([{ path: "evil.md", text: `\`${payload}\`` }])[0]).toMatch(/does not exist/);
    expect(existsSync("/tmp/check-context-should-not-exist")).toBe(false);
  });

  it("reports the line number, so a failure is one click from the claim", () => {
    const failures = check([{ path: "fixture.md", text: "line one\nline two\n`src/nope/gone.ts`" }]);
    expect(failures[0]).toContain("fixture.md:3");
  });
});
