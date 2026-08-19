// Tests for the context-doc path checker.
//
// The value of this suite is almost entirely in the NEGATIVE cases. A path checker that finds
// nothing looks identical whether it is working or whether its matcher stopped matching — the
// #589 failure. So the cases below pin what it deliberately ignores as hard as what it catches.
//
// EVERYTHING RUNS AGAINST A FIXTURE TREE, not against the repo the suite happens to sit in.
// That is the whole reason this file was rewritten. `check-context.mjs` reads the filesystem
// through the cwd — `ROOTS` is built from `readdirSync('.')` at module load, and `resolves()`
// calls `existsSync` on a relative path — so every assertion below is a claim about the layout
// of whatever repo runs it. The original suite asserted that `src/adapters/twilio-channel.ts`
// and `app/(crew)/crew/shift/[shiftId]` were real, which is true in exactly one repo. It passed
// there and failed 9 ways in seeds, and nobody knew, because seeds had no test runner (issue
// #186) and no other project ran the script tests either. A suite that can only pass in the
// repo it was written in is not portable, and this one ships to every project.
//
// So: build the tree the assertions describe, `chdir` into it, and import the module afterwards
// so its cwd-derived constants are computed against the fixture. The import must come after the
// chdir — `ROOTS` is module-load-time state, which is exactly why this can't be done with a
// plain top-level import.
//
// What this deliberately gives up: the old `check()` case asserted the REAL docs of the host
// repo were clean. That assertion belongs to the gate — running `check-context.mjs` in `verify`
// is what checks a project's actual docs, on every run, against the real tree. A unit suite
// doing it too only bought a second opinion in one repo while making it unrunnable everywhere.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let check, checkSections, expandBraces, headings, isClaim, sectionMatches, sectionRefs;
let fixture;
let cwdBefore;

/**
 * The tree the assertions below describe. Shaped like a Next.js + App Router project because
 * that is what the checker's own comments cite as the motivating cases: a route group, a dynamic
 * segment whose brackets are not a character class, and an adapter glob.
 */
const FIXTURE_FILES = [
  "CLAUDE.md",
  ".claude/CLAUDE-context.md",
  "src/adapters/twilio-channel.ts",
  "src/adapters/sms-channel.ts",
  "app/lib/channel.ts",
  "app/(crew)/crew/shift/[shiftId]/page.tsx",
  "docs/decisions/DEC-143-x.md",
  // Target of the § tests. Its heading set is the point: `Workflow Overrides` is the
  // pre-DEC-S042 shape bushel actually had, and `Permission settings (DEC-042)` is cited
  // without its parenthetical, so both real-corpus shapes are represented.
  "target.md",
  "notes.txt",
  "scripts/check-decisions.mjs",
  "scripts/gen-decisions-index.mjs",
  // A top-level `components/` so the `<placeholder>` case proves the angle-bracket rule rather
  // than passing for the uninteresting reason that `components` is not a root here.
  "components/.keep",
];

// Deliberately ABSENT from the fixture, and each absence is load-bearing:
//   dev/                        — so `dev/claude/...` reads as another repo's path, not a claim
//   origin/, feature/           — so those spans read as git refs
//   @core/                      — so the tsconfig alias is not a path
//   app/(crew)/crew/ask/        — the dead-brace case cites `{ask,nowhere}`, and `patternMatches`
//                                 passes a brace pattern if ANY alternative resolves (`.some()`
//                                 at check-context.mjs:122). So BOTH alternatives have to be
//                                 missing for that expansion to count as dead. Creating `ask/`
//                                 here silently turned the negative control green — caught only
//                                 because the assertion pins an exact failure count.

beforeAll(async () => {
  fixture = mkdtempSync(join(tmpdir(), "check-context-fixture-"));
  for (const rel of FIXTURE_FILES) {
    const abs = join(fixture, rel);
    mkdirSync(dirname(abs), { recursive: true });
    // The two context docs must parse as clean: they are what no-arg `check()` reads.
    writeFileSync(abs, rel.endsWith(".md") ? "See `src/adapters/twilio-channel.ts`.\n" : "");
  }
  writeFileSync(
    join(fixture, "target.md"),
    [
      "# Doc",
      "",
      "## Workflow Overrides",
      "",
      "text",
      "",
      "## Permission settings (DEC-042)",
      "",
      "text",
      "",
      // A single-word heading, mirroring the real corpus — `dev/claude/CLAUDE.md` has five
      // (`## Tone`, `## Agents`, `## Communication`, `## Conventions`, `## Versioning`). It is
      // here to pin the documented LIMIT of the matching rule, not a success.
      "## Tone",
      "",
      "text",
      "",
      // A numbered heading with an em-dash subtitle — muster's `docs/SPEC.md:1808` shape,
      // `# 4. Parked — deliberately deferred, not reopened`, cited from its context file as
      // "§4 *Parked* + the 2027 line". Both sides agree on the name and then run into
      // DIFFERENT prose, which the word-prefix rule alone cannot reconcile. Absent from the
      // fixture until now, which is exactly why the suite could not catch it: PR #190 made
      // these tests portable by moving to a synthetic tree, and a synthetic tree only ever
      // contains the shapes someone thought to write.
      "# 4. Parked — deliberately deferred, not reopened",
      "",
      "text",
      "",
      // Shares the truncated name with the heading above. Pins that truncating at the
      // subtitle does not silently merge two distinct sections into one match.
      "# 5. Parked ideas — not the same section",
      "",
      "text",
      "",
    ].join("\n"),
  );
  cwdBefore = process.cwd();
  process.chdir(fixture);
  // Imported AFTER the chdir on purpose — see the header note.
  ({ check, checkSections, expandBraces, headings, isClaim, sectionMatches, sectionRefs } =
    await import("./check-context.mjs"));
});

afterAll(() => {
  if (cwdBefore) process.chdir(cwdBefore);
  if (fixture) rmSync(fixture, { recursive: true, force: true });
});

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

  it("ignores another repo's paths, which correctly do not exist in this one", () => {
    expect(isClaim("dev/claude/templates/VersionTag.tsx")).toBe(false);
  });

  it("ignores an explicit <placeholder>, since Next route params are real dirs", () => {
    // `components/<feature>/` describes a shape; `app/(crew)/crew/shift/[shiftId]` is a real
    // directory, so brackets can't be the placeholder marker — angle brackets are. `components`
    // IS a root in the fixture, so this fails for the right reason if the rule is removed.
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
  it("passes on docs whose every cited path and pattern resolves", () => {
    // No-arg `check()` reads the two context docs off disk — here, the fixture's. Asserting the
    // HOST repo's real docs is the gate's job, not this suite's; see the header note.
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

describe("§ section references", () => {
  const cite = (text) => checkSections([{ path: "f.md", text }]);

  it("catches the bushel failure: a section the target does not have", () => {
    // The motivating case (issue #181). The DEC-S042 shell cited
    // `.claude/CLAUDE-context.md § Workflow Mechanisms` into a project whose context file had
    // `## Workflow Overrides` — three dead pointers per task, past three green gates.
    expect(cite("slots live in `target.md` § Workflow Mechanisms")).toHaveLength(1);
    expect(cite("slots live in `target.md` § Workflow Mechanisms")[0]).toMatch(/has no such section/);
  });

  it("does not match on a shared first word, which is what makes the case above catchable", () => {
    // `Workflow Mechanisms` and `Workflow Overrides` share their first word. A rule that accepted
    // any prefix of the citation would pass the dead reference — the whole check would be inert
    // on the one failure it was written for. Comparison is on whole words from the front.
    expect(sectionMatches("Workflow Mechanisms", [["Workflow", "Overrides"]])).toBe(false);
    expect(sectionMatches("Workflow Overrides", [["Workflow", "Overrides"]])).toBe(true);
  });

  it("accepts a live reference that runs on into prose", () => {
    // A citation has no closing delimiter. `§ Communication for the session that prompted it` is
    // live; only the first word is the heading. Failing this would be crying wolf on a good doc.
    expect(cite("see `target.md` § Workflow Overrides for the details")).toEqual([]);
  });

  it("accepts a citation SHORTER than the heading", () => {
    // `README.md § Permission settings` points at `## Permission settings (DEC-S023)`. The
    // decision id is provenance, not part of the name, so the citation is a prefix of the heading
    // rather than the other way round — both directions have to match.
    expect(cite("policy: `target.md` § Permission settings")).toEqual([]);
  });

  it("reads the form with § inside the backticks, where the closing tick ends the heading", () => {
    expect(sectionRefs("see `target.md §Workflow Overrides` today")).toEqual([
      { file: "target.md", section: "Workflow Overrides" },
    ]);
    expect(cite("see `target.md §Workflow Overrides` today")).toEqual([]);
    expect(cite("see `target.md §Nowhere` today")).toHaveLength(1);
  });

  it("ignores a bare § with no backticked file", () => {
    // Deliberate scope limit. Run over the real corpus the bare form produced 12 findings and
    // about one was real: historical task rows use `§` as ordinary prose about other repos'
    // documents. A gate reporting eleven false findings to catch one gets muted.
    expect(sectionRefs("see § Workflow Mechanisms below")).toEqual([]);
    expect(cite("see § Nowhere At All below")).toEqual([]);
  });

  it("ignores a non-markdown target, which has no headings to resolve against", () => {
    // `.claude/routine-config.yaml` § `file-classes` is a real citation in seeds' own CLAUDE.md.
    expect(cite("classes: `notes.txt` § file-classes")).toEqual([]);
  });

  it("ignores a target that does not exist — path existence is checkPaths' job", () => {
    // A doc describing what a PROJECT holds legitimately names files this repo does not have;
    // `docs/WORKFLOW.md` cites `.claude/CLAUDE-context.md § Commands` and seeds has no such file.
    expect(cite("see `no-such-doc.md` § Anything At All")).toEqual([]);
  });

  it("does not let one citation swallow the next one on the same line", () => {
    // Two file-scoped citations on one line. Without a stop boundary the first one's text ran to
    // end of line and picked up the second's syntax, so it no longer prefix-matched its own
    // heading — a false failure. Live shape in this repo, in a decision file:
    // "`dev/claude/CLAUDE.md` § Memory removed (section sat between § Workflow Notes and …)".
    expect(sectionRefs("see `target.md` § Tone and also `target.md` § Workflow Overrides")).toEqual([
      { file: "target.md", section: " Tone and also " },
      { file: "target.md", section: " Workflow Overrides" },
    ]);
    expect(cite("see `target.md` § Tone and also `target.md` § Workflow Overrides")).toEqual([]);
  });

  it("PINS THE LIMIT: a citation beginning with a real short heading passes whatever follows", () => {
    // Not a success — a documented limit, asserted so it is a decision rather than an accident.
    // `target.md` has `## Tone`, so `§ Tone of every reply` resolves even though no such section
    // exists. A citation has no closing delimiter and legitimately runs into its sentence, so
    // nothing mechanical separates trailing prose from an over-long section name. The check
    // answers "is there a heading here to land on?", and a reader following this one lands on
    // `## Tone`. Tightening it would redden the live reference in the case above.
    expect(cite("style: `target.md` § Tone of every reply")).toEqual([]);
    // The failure that still matters — nothing to land on at all — is unaffected:
    expect(cite("style: `target.md` § Telemetry of every reply")).toHaveLength(1);
  });

  it("strips per-word punctuation and a trailing parenthetical from headings", () => {
    expect(headings("## Permission settings (DEC-042)\n### v4 → v5\n")).toEqual([
      ["Permission", "settings"],
      ["v4", "→", "v5"],
    ]);
    // `§ Seeds' Own Decision Record. There **is** …` — the fourth word must compare as `Record`.
    expect(sectionMatches("Own Decision Record. There **is** more", [["Own", "Decision", "Record"]])).toBe(true);
  });

  it("resolves a numbered heading with an em-dash subtitle, cited into its own sentence", () => {
    // muster's live shape, and the first false POSITIVE this checker produced. Its context file
    // says `docs/SPEC.md` §4 *Parked* + the 2027 line; `docs/SPEC.md:1808` is
    // `# 4. Parked — deliberately deferred, not reopened`. The citation is correct and the check
    // called it dead: both sides agree on `4 Parked`, then the heading continues into its subtitle
    // and the citation continues into its sentence, so neither is a word-prefix of the other.
    //
    // This is the expensive direction of failure. A gate that reddens on correct docs gets muted,
    // which the rule's own note at check-context.mjs already says.
    expect(cite("Check `target.md` §4 *Parked* + the 2027 line before adding anything")).toEqual([]);
    // The dash side alone, with no trailing prose on the citation:
    expect(cite("see `target.md` § 4. Parked")).toEqual([]);
  });

  it("a citation with no separator of its own is still compared in FULL against a subtitled heading", () => {
    // The finding that came out of review, and the reason the subtitle rule is a fallback rather
    // than a normalization. Truncating unconditionally collapsed `## The Routine — OFF, and now
    // unrevivable` to `The Routine`, which made it a landing point for anything starting with
    // those two words — so a genuinely dead `§ The Routine is active again` resolved. That is
    // issue #181's failure wearing a subtitle, and `## Step N — …` is the dominant heading shape
    // in this repo's own skills, so it would have reddened nothing and hidden everything.
    const routine = headings("## The Routine — OFF, and now unrevivable (DEC-S038)\n");
    expect(sectionMatches("The Routine is active again", routine)).toBe(false);
    // The same heading, cited correctly, still resolves — both by exact prefix …
    expect(sectionMatches("The Routine", routine)).toBe(true);
    // … and by the fallback, when the citation runs into prose after its own separator.
    expect(sectionMatches("The Routine — still off today", routine)).toBe(true);
  });

  it("does not let a wrong name land on a sibling heading that shares its subtitle shape", () => {
    // `target.md` has BOTH `# 4. Parked — …` and `# 5. Parked ideas — …`, so a wrong first word
    // must not walk onto either. `4 Sailing` shares the number with heading 4 and the shape with
    // both, and resolves to neither.
    expect(cite("see `target.md` § 4. Sailing — whatever follows")).toHaveLength(1);
    // Cited correctly, each still lands on its own:
    expect(cite("see `target.md` § 4. Parked — deliberately deferred")).toEqual([]);
    expect(cite("see `target.md` § 5. Parked ideas — not the same")).toEqual([]);
    // The negative control this whole check exists for (issue #181) is unaffected: a subtitle rule
    // must not let `Workflow Mechanisms` land on `## Workflow Overrides`.
    expect(sectionMatches("Workflow Mechanisms", [["Workflow", "Overrides"]])).toBe(false);
    expect(cite("slots live in `target.md` § Workflow Mechanisms")).toHaveLength(1);
    // A dash inside the citation must not truncate away a genuine mismatch either.
    expect(cite("see `target.md` § Telemetry — of every reply")).toHaveLength(1);
  });

  it("a citation inside a markdown table stops at the cell boundary", () => {
    // soundings' `docs/SPEC.md:422` — a decision-ledger table whose cell ends
    // "See `docs/HARDWARE_BUILD_PLAN.md` §3. |". The section text ran past the `|` and swallowed
    // the rest of the row, so a citation of a real heading (`## 3. Gateway architecture —
    // recommendation`) did not resolve. Same family as the backtick and `§` bounds already here:
    // a citation has no closing delimiter, so it stops at whatever structure encloses it.
    expect(cite("| D3 | radio choice. See `target.md` §4. | decided at the bench |")).toEqual([]);
    // A dead reference in a table is still dead — the bound cuts the text, it does not invent a
    // heading. This passes with or without the fix and is a plain sanity check, not a discriminator.
    expect(cite("| D4 | see `target.md` § Telemetry. | later |")).toHaveLength(1);
    // A `|` INSIDE the backticks is part of the citation, not a boundary — the closing backtick
    // already delimits it, so that branch must not split. Asserted with an actual pipe, because
    // the first version of this case contained none and therefore tested nothing.
    expect(sectionRefs("see `target.md §Workflow | Overrides` today")).toEqual([
      { file: "target.md", section: "Workflow | Overrides" },
    ]);
  });

  it("PINS THE LIMIT: the cell bound can shorten a citation onto a heading it merely starts", () => {
    // Truncation only ever shortens, and a shorter citation is easier to match — so the bound
    // widens what resolves. `§ Workflow | Mechanisms |` cut at the cell edge is `Workflow`, which
    // word-prefixes `## Workflow Overrides` and now resolves, where the unbounded text did not.
    //
    // Kept as a limit rather than fixed, and the reason is what a `|` means: in a table it IS the
    // cell edge, so `Mechanisms` is the NEXT CELL and was never part of the citation. Reading it
    // as `§ Workflow` is correct, and landing on the one heading that starts with `Workflow` is
    // the same documented limit the whole matcher already carries. Written down because it is the
    // #181 shape, and a reader who finds it should see a decision, not an oversight.
    expect(cite("| D5 | see `target.md` § Workflow | Mechanisms |")).toEqual([]);
    // The prose form, with no cell edge to cut at, still fails — which is #181 itself, untouched:
    expect(cite("slots live in `target.md` § Workflow Mechanisms")).toHaveLength(1);
  });

  it("a heading that BEGINS with a separator stays citable", () => {
    // `sectionName` returns null rather than an empty name, so `## — Untitled` is compared in
    // full instead of becoming silently unmatchable — the same failure direction as the bug this
    // whole change fixes, just narrower.
    const odd = headings("## — Untitled subtitle\n");
    expect(sectionMatches("— Untitled subtitle", odd)).toBe(true);
  });
});
