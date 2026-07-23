/**
 * `db:reset:dev` target guard (`resolveTarget`). This is a destructive script, so the only
 * thing worth unit-testing is what it REFUSES — a guard that's wrong once is worse than no
 * guard, because it's trusted.
 */
import { describe, expect, it } from "vitest";
import { resolveTarget } from "./reset-dev.js";

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
