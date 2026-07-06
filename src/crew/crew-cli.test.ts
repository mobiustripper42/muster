import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember } from "../domain/entities.js";
import { CrewCliError, runCrewCommand } from "./crew-cli.js";

const crew = (over: Partial<CrewMember> = {}): CrewMember => ({
  id: asId<"CrewMemberId">("crew-eric"),
  name: "Eric Stoffer",
  phone: "+15555550101",
  ratings: [asId<"RoleTypeId">("role-captain")],
  status: "active",
  reliabilityScore: null,
  ...over,
});

describe("db:crew CLI (Phase 10.5)", () => {
  let repo: InMemoryRepository;
  beforeEach(async () => {
    repo = new InMemoryRepository();
    await repo.saveCrewMember(crew());
  });

  it("set --email normalizes (trim + lowercase) and persists", async () => {
    const out = await runCrewCommand(repo, ["set", "crew-eric", "--email=  Eric@Stoffer.Net "]);
    expect(out).toContain("eric@stoffer.net");
    expect((await repo.getCrewMember(asId<"CrewMemberId">("crew-eric")))!.email).toBe(
      "eric@stoffer.net",
    );
  });

  it("set --phone accepts E.164 and rejects a non-E.164 number", async () => {
    await runCrewCommand(repo, ["set", "crew-eric", "--phone=+15035550123"]);
    expect((await repo.getCrewMember(asId<"CrewMemberId">("crew-eric")))!.phone).toBe(
      "+15035550123",
    );
    await expect(
      runCrewCommand(repo, ["set", "crew-eric", "--phone=503-555-0123"]),
    ).rejects.toThrow(/not E\.164/i);
    // the bad phone did not overwrite the good one
    expect((await repo.getCrewMember(asId<"CrewMemberId">("crew-eric")))!.phone).toBe(
      "+15035550123",
    );
  });

  it("empty --email= clears the email; phone cannot be blanked", async () => {
    await repo.saveCrewMember(crew({ email: "old@x.com" }));
    const out = await runCrewCommand(repo, ["set", "crew-eric", "--email="]);
    expect(out).toContain("cleared");
    expect((await repo.getCrewMember(asId<"CrewMemberId">("crew-eric")))!.email).toBeUndefined();
    await expect(
      runCrewCommand(repo, ["set", "crew-eric", "--phone="]),
    ).rejects.toThrow(/not E\.164/i);
  });

  it("set --name trims and updates; a blank --name= is rejected", async () => {
    await runCrewCommand(repo, ["set", "crew-eric", "--name=  Eric S  "]);
    expect((await repo.getCrewMember(asId<"CrewMemberId">("crew-eric")))!.name).toBe("Eric S");
    // `--name=` is present-but-empty → hits the blank guard (unlike email, name can't clear).
    await expect(
      runCrewCommand(repo, ["set", "crew-eric", "--name="]),
    ).rejects.toThrow(/cannot be blank/i);
  });

  it("set can change several fields at once", async () => {
    const out = await runCrewCommand(repo, [
      "set",
      "crew-eric",
      "--email=new@x.com",
      "--phone=+14155550199",
      "--name=New Name",
    ]);
    expect(out).toContain("new@x.com");
    expect(out).toContain("+14155550199");
    expect(out).toContain("New Name");
    const c = await repo.getCrewMember(asId<"CrewMemberId">("crew-eric"));
    expect(c).toMatchObject({ email: "new@x.com", phone: "+14155550199", name: "New Name" });
  });

  it("set on an unknown id errors and points at `list`", async () => {
    await expect(
      runCrewCommand(repo, ["set", "crew-ghost", "--email=a@b.com"]),
    ).rejects.toThrow(/no crew member with id "crew-ghost"/i);
  });

  it("set with no fields, and a rejected bad email, are clear errors", async () => {
    await expect(runCrewCommand(repo, ["set", "crew-eric"])).rejects.toThrow(/at least one/i);
    await expect(
      runCrewCommand(repo, ["set", "crew-eric", "--email=not-an-email"]),
    ).rejects.toThrow(/doesn't look like an email/i);
  });

  it("set requires a crew id before the flags", async () => {
    await expect(
      runCrewCommand(repo, ["set", "--email=a@b.com"]),
    ).rejects.toThrow(/a crew id is required/i);
  });

  it("list shows crew sorted by name with a (no email) placeholder", async () => {
    await repo.saveCrewMember(crew({ id: asId<"CrewMemberId">("crew-abe"), name: "Abe" }));
    const out = await runCrewCommand(repo, ["list"]);
    expect(out.indexOf("Abe")).toBeLessThan(out.indexOf("Eric Stoffer"));
    expect(out).toContain("(no email)");
  });

  it("an unknown command throws with usage", async () => {
    await expect(runCrewCommand(repo, ["frobnicate"])).rejects.toBeInstanceOf(CrewCliError);
    await expect(runCrewCommand(repo, [])).rejects.toThrow(/Usage/);
  });
});
