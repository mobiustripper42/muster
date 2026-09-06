/**
 * `db:reset:dev` target guard (`resolveTarget`). This is a destructive script, so the only
 * thing worth unit-testing is what it REFUSES — a guard that's wrong once is worse than no
 * guard, because it's trusted.
 */
import { describe, expect, it } from "vitest";
import { parseSeeds, resolveTarget } from "./reset-dev.js";

const local = (db: string) => `postgres://muster:muster@localhost:5432/${db}`;

describe("resolveTarget — what it accepts", () => {
  it("accepts the local dev and test databases", () => {
    expect(resolveTarget(local("muster_dev"))).toMatchObject({
      host: "localhost",
      database: "muster_dev",
    });
    expect(resolveTarget(local("muster_test")).database).toBe("muster_test");
  });

  it("accepts the docker-compose service hostnames", () => {
    expect(resolveTarget("postgres://u:p@db:5432/muster_dev").host).toBe("db");
    expect(resolveTarget("postgres://u:p@127.0.0.1:5432/muster_dev").host).toBe("127.0.0.1");
  });
});

describe("resolveTarget — what it refuses", () => {
  it("refuses any remote host, even with an allowlisted database name", () => {
    // The realistic disaster: a prod URL pasted into DATABASE_URL, pointing at a database
    // that happens to be called muster_dev.
    expect(() => resolveTarget("postgres://u:p@ep-cool-name.neon.tech/muster_dev")).toThrow(
      /Refusing to reset a database on host/,
    );
    expect(() => resolveTarget("postgres://u:p@10.0.0.5:5432/muster_dev")).toThrow(
      /Refusing to reset a database on host/,
    );
  });

  it("refuses a non-allowlisted database name, even on localhost", () => {
    expect(() => resolveTarget(local("muster_prod"))).toThrow(/not on the allowlist/);
    expect(() => resolveTarget(local("postgres"))).toThrow(/not on the allowlist/);
    expect(() => resolveTarget(local(""))).toThrow(/not on the allowlist/);
  });

  it("refuses an unparseable URL rather than guessing", () => {
    expect(() => resolveTarget("not a url")).toThrow(/not a parseable URL/);
    expect(() => resolveTarget("")).toThrow(/not a parseable URL/);
  });

  it("points a refused caller at the right tool instead of dead-ending them", () => {
    expect(() => resolveTarget("postgres://u:p@prod.example.com/muster_dev")).toThrow(
      /reset-pilot/,
    );
  });
});

/**
 * `--seeds` parsing. The guard above is about refusing the wrong DATABASE; this is about
 * refusing to guess at the wrong FIXTURES — a reset that silently seeds something other than
 * what you asked for sends you debugging an empty page instead of the flag you mistyped.
 */
describe("parseSeeds", () => {
  it("reads the space-separated form", () => {
    expect(parseSeeds(["--seeds", "fleet,crew"])).toEqual(["fleet", "crew"]);
  });

  it("reads the --seeds=a,b form", () => {
    // The form `npm run` users reach for first, and the one the timeclock seed's own docs
    // used. It parsed as a single unrecognised token, so `indexOf("--seeds")` missed it and
    // the run silently fell back to DEFAULT_SEEDS — a reset that looked like it worked and
    // seeded something else entirely.
    expect(parseSeeds(["--seeds=fleet,crew,timeclock"])).toEqual(["fleet", "crew", "timeclock"]);
  });

  it("defaults only when no --seeds flag is present at all", () => {
    // The standard dev world (#937) — five seeds, not the original three. Written out
    // rather than compared against DEFAULT_SEEDS, so widening the set is a decision
    // someone makes here rather than something the test agrees to silently.
    const STANDARD = ["fleet", "crew", "reservation", "xola", "atrisk"];
    expect(parseSeeds([])).toEqual(STANDARD);
    expect(parseSeeds(["--fresh"])).toEqual(STANDARD);
  });

  it("still refuses an unknown seed name in either form", () => {
    expect(() => parseSeeds(["--seeds", "fleet,nope"])).toThrow(/Unknown seed/);
    expect(() => parseSeeds(["--seeds=nope"])).toThrow(/Unknown seed/);
  });

  it("refuses an empty list rather than defaulting", () => {
    expect(() => parseSeeds(["--seeds="])).toThrow(/comma-separated/);
    expect(() => parseSeeds(["--seeds"])).toThrow(/comma-separated/);
  });

  it("--no-seed still wins", () => {
    expect(parseSeeds(["--no-seed", "--seeds=fleet"])).toEqual([]);
  });
});
