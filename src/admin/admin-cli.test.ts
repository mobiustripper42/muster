import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember } from "../domain/entities.js";
import { AdminCliError, runAdminCommand } from "./admin-cli.js";

const NOW = new Date("2026-07-06T12:00:00.000Z");

const crew = (over: Partial<CrewMember> = {}): CrewMember => ({
  id: asId<"CrewMemberId">("crew-eric"),
  name: "Eric Stoffer",
  phone: "+15555550101",
  ratings: [asId<"RoleTypeId">("role-captain")],
  status: "active",
  reliabilityScore: null,
  ...over,
});

describe("db:admin CLI (DEC-092)", () => {
  let repo: InMemoryRepository;
  beforeEach(() => {
    repo = new InMemoryRepository();
  });

  it("add --crew --handle --name → the admin round-trips and lists", async () => {
    const out = await runAdminCommand(
      repo,
      ["add", "--crew=crew-eric", "--handle=eric", "--name=Eric Stoffer"],
      NOW,
    );
    expect(out).toContain("crew-eric");
    const a = await repo.getAdminByHandle("eric");
    expect(a).toMatchObject({ id: "crew-eric", handle: "eric", name: "Eric Stoffer", active: true });
    expect(a!.createdAt).toBe(NOW.toISOString());
    expect(await runAdminCommand(repo, ["list"], NOW)).toContain("eric");
  });

  it("add --crew takes the name from the crew record when --name is omitted", async () => {
    await repo.saveCrewMember(crew());
    await runAdminCommand(repo, ["add", "--crew=crew-eric", "--handle=eric"], NOW);
    expect((await repo.getAdminByHandle("eric"))!.name).toBe("Eric Stoffer");
  });

  it("add --email resolves the crew id from the roster (case-insensitive)", async () => {
    await repo.saveCrewMember(crew({ email: "Eric@Stoffer.net" }));
    const out = await runAdminCommand(
      repo,
      ["add", "--email=eric@stoffer.net", "--handle=eric"],
      NOW,
    );
    expect(out).toContain("crew-eric");
    expect((await repo.getAdminByHandle("eric"))!.id).toBe("crew-eric");
  });

  it("add --email with no roster match is a clear error (crew ≠ Xola customers)", async () => {
    await expect(
      runAdminCommand(repo, ["add", "--email=nobody@x.com", "--handle=x"], NOW),
    ).rejects.toThrow(/no crew member has email/i);
  });

  it("add rejects a duplicate handle and a re-used crew id", async () => {
    await runAdminCommand(repo, ["add", "--crew=crew-eric", "--handle=eric", "--name=E"], NOW);
    await expect(
      runAdminCommand(repo, ["add", "--crew=crew-other", "--handle=eric", "--name=X"], NOW),
    ).rejects.toThrow(/handle "eric" is already an admin/i);
    await expect(
      runAdminCommand(repo, ["add", "--crew=crew-eric", "--handle=eric2", "--name=X"], NOW),
    ).rejects.toThrow(/crew-eric is already admin "eric"/i);
  });

  it("add requires exactly one of --email/--crew, and a --handle", async () => {
    await expect(runAdminCommand(repo, ["add", "--handle=x"], NOW)).rejects.toThrow(/exactly one/i);
    await expect(
      runAdminCommand(repo, ["add", "--email=a@b.c", "--crew=crew-x", "--handle=x"], NOW),
    ).rejects.toThrow(/exactly one/i);
    await expect(runAdminCommand(repo, ["add", "--crew=crew-x"], NOW)).rejects.toThrow(/--handle/i);
  });

  it("revoke flips active + stamps deactivatedAt; re-revoke is a no-op", async () => {
    await runAdminCommand(repo, ["add", "--crew=crew-eric", "--handle=eric", "--name=E"], NOW);
    const out = await runAdminCommand(repo, ["revoke", "eric"], NOW);
    expect(out).toMatch(/revoked/i);
    const a = await repo.getAdminByHandle("eric");
    expect(a!.active).toBe(false);
    expect(a!.deactivatedAt).toBe(NOW.toISOString());
    expect(await runAdminCommand(repo, ["revoke", "eric"], NOW)).toMatch(/already revoked/i);
  });

  it("reactivate clears the flag; revoke/reactivate on an unknown handle errors", async () => {
    await runAdminCommand(repo, ["add", "--crew=crew-eric", "--handle=eric", "--name=E"], NOW);
    await runAdminCommand(repo, ["revoke", "eric"], NOW);
    await runAdminCommand(repo, ["reactivate", "eric"], NOW);
    const a = await repo.getAdminByHandle("eric");
    expect(a!.active).toBe(true);
    expect(a!.deactivatedAt).toBeNull();
    await expect(runAdminCommand(repo, ["revoke", "ghost"], NOW)).rejects.toThrow(/no admin/i);
  });

  it("an unknown command throws with usage", async () => {
    await expect(runAdminCommand(repo, ["frobnicate"], NOW)).rejects.toBeInstanceOf(AdminCliError);
    await expect(runAdminCommand(repo, [], NOW)).rejects.toThrow(/Usage/);
  });
});
