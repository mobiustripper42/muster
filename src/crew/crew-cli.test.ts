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

const TENANT = asId<"TenantId">("tenant-x");

describe("db:crew CLI (Phase 10.5)", () => {
  let repo: InMemoryRepository;
  beforeEach(async () => {
    repo = new InMemoryRepository();
    await repo.saveCrewMember(crew());
    // Role types `add --ratings` resolves against.
    await repo.saveRoleType({ id: asId<"RoleTypeId">("role-captain"), tenantId: TENANT, name: "captain" });
    await repo.saveRoleType({ id: asId<"RoleTypeId">("role-mate"), tenantId: TENANT, name: "mate" });
  });

  it("add creates an ASKABLE crew member: record + placeholder MMC + derived id", async () => {
    const out = await runCrewCommand(repo, [
      "add",
      "--name=Jane Roe",
      "--phone=+12165550142",
      "--ratings=captain,mate",
      "--email=Jane@Roe.com",
    ]);
    expect(out).toContain("crew-jane-roe");
    const c = await repo.getCrewMember(asId<"CrewMemberId">("crew-jane-roe"));
    expect(c).toMatchObject({
      name: "Jane Roe",
      phone: "+12165550142",
      email: "jane@roe.com",
      status: "active",
      reliabilityScore: null,
    });
    expect(c!.ratings).toEqual([asId<"RoleTypeId">("role-captain"), asId<"RoleTypeId">("role-mate")]);
    // The MMC credential (DEC-044) — without it the hire is eligible for nothing.
    const creds = await repo.listCredentialsForCrew(asId<"CrewMemberId">("crew-jane-roe"));
    expect(creds).toHaveLength(1);
    expect(creds[0]).toMatchObject({ type: "MMC", expiry: "2099-12-31" });
    expect(out).toContain("placeholder");
  });

  it("rank: orders crew by reliability score, best first, with events + thumb marker", async () => {
    const now = new Date("2026-07-13T12:00:00.000Z");
    await repo.saveCrewMember(crew({ id: asId<"CrewMemberId">("crew-quint"), name: "Quint" }));
    await repo.saveCrewMember(crew({ id: asId<"CrewMemberId">("crew-brody"), name: "Brody", manualFloor: 5 }));
    // Eric: two completed shifts (+5 each = 10). Quint: empty log (neutral 0).
    // Brody: empty but a manual floor of 5 sits him between them.
    for (const id of ["r1", "r2"]) {
      await repo.logReliabilityEvent({
        id: asId<"ReliabilityEventId">(id),
        crewMemberId: asId<"CrewMemberId">("crew-eric"),
        type: "shift_completed",
        timestamp: "2026-07-10T12:00:00.000Z",
        metadata: {},
      });
    }
    const out = await runCrewCommand(repo, ["rank"], now);
    const pos = (name: string) => out.indexOf(name);
    // Eric (10) above Brody (floored to 5) above Quint (0).
    expect(pos("Eric")).toBeLessThan(pos("Brody"));
    expect(pos("Brody")).toBeLessThan(pos("Quint"));
    expect(out).toContain("events"); // the column renders
    expect(out).toMatch(/5\.0\*/); // Brody's floored score carries the manual-thumb marker
  });

  it("add: --mmc sets a real expiry; --id overrides the derived id; ratings dedupe", async () => {
    const out = await runCrewCommand(repo, [
      "add",
      "--name=Sam Poe",
      "--phone=+12165550143",
      "--ratings=mate,mate",
      "--id=crew-sammy",
      "--mmc=2027-03-01",
    ]);
    expect(out).toContain("crew-sammy");
    expect(out).toContain("valid to 2027-03-01");
    const c = await repo.getCrewMember(asId<"CrewMemberId">("crew-sammy"));
    expect(c!.ratings).toEqual([asId<"RoleTypeId">("role-mate")]); // deduped
    expect("email" in c!).toBe(false); // no --email → omitted
    const creds = await repo.listCredentialsForCrew(asId<"CrewMemberId">("crew-sammy"));
    expect(creds[0]!.expiry).toBe("2027-03-01");
  });

  it("add validates required fields, E.164, roles, dates, and rejects a dup id/email", async () => {
    await expect(runCrewCommand(repo, ["add", "--phone=+12165550142", "--ratings=mate"])).rejects.toThrow(
      /--name.*required/i,
    );
    await expect(
      runCrewCommand(repo, ["add", "--name=X", "--phone=216-555", "--ratings=mate"]),
    ).rejects.toThrow(/E\.164/i);
    await expect(
      runCrewCommand(repo, ["add", "--name=X", "--phone=+12165550142", "--ratings=skipper"]),
    ).rejects.toThrow(/isn't a known role.*captain, mate/i);
    await expect(
      runCrewCommand(repo, ["add", "--name=X", "--phone=+12165550142", "--ratings=mate", "--mmc=03/01/2027"]),
    ).rejects.toThrow(/YYYY-MM-DD/i);
    // dup id (crew-eric already exists)
    await expect(
      runCrewCommand(repo, ["add", "--name=Eric", "--phone=+12165550142", "--ratings=mate", "--id=crew-eric"]),
    ).rejects.toThrow(/already exists/i);
    // dup email
    await repo.saveCrewMember(crew({ id: asId<"CrewMemberId">("crew-x"), email: "taken@x.com" }));
    await expect(
      runCrewCommand(repo, ["add", "--name=Y", "--phone=+12165550142", "--ratings=mate", "--email=taken@x.com"]),
    ).rejects.toThrow(/already on crew-x/i);
  });

  it("add rejects an invalid calendar date and derives colliding ids / empty slugs", async () => {
    // A shape-valid but impossible date must not silently roll forward.
    await expect(
      runCrewCommand(repo, ["add", "--name=X", "--phone=+12165550142", "--ratings=mate", "--mmc=2027-04-31"]),
    ).rejects.toThrow(/real date/i);
    // Two hires with the same name collide on the derived crew-<slug> id.
    await runCrewCommand(repo, ["add", "--name=Jane Roe", "--phone=+12165550142", "--ratings=mate"]);
    await expect(
      runCrewCommand(repo, ["add", "--name=Jane Roe", "--phone=+12165550143", "--ratings=mate"]),
    ).rejects.toThrow(/id "crew-jane-roe" already exists/i);
    // A name that slugifies to empty must demand an explicit --id.
    await expect(
      runCrewCommand(repo, ["add", "--name=!!!", "--phone=+12165550144", "--ratings=mate"]),
    ).rejects.toThrow(/couldn't derive an id/i);
  });

  it("disable → inactive, enable → active; unknown id errors", async () => {
    expect(await runCrewCommand(repo, ["disable", "crew-eric"])).toMatch(/won't be asked/i);
    expect((await repo.getCrewMember(asId<"CrewMemberId">("crew-eric")))!.status).toBe("inactive");
    expect(await runCrewCommand(repo, ["enable", "crew-eric"])).toMatch(/ask pool/i);
    expect((await repo.getCrewMember(asId<"CrewMemberId">("crew-eric")))!.status).toBe("active");
    await expect(runCrewCommand(repo, ["disable", "crew-ghost"])).rejects.toThrow(/no crew member/i);
    await expect(runCrewCommand(repo, ["enable"])).rejects.toThrow(/a crew id is required/i);
    // a stray trailing arg is rejected, not silently ignored
    await expect(runCrewCommand(repo, ["disable", "crew-eric", "--typo=1"])).rejects.toThrow(
      /unexpected argument/i,
    );
  });

  it("archive → archived, unarchive → active; list marks archived with ✗ (#323)", async () => {
    const eric = asId<"CrewMemberId">("crew-eric");
    expect(await runCrewCommand(repo, ["archive", "crew-eric"])).toMatch(/off every list/i);
    expect((await repo.getCrewMember(eric))!.status).toBe("archived");
    // list renders the archived marker, distinct from ● active / ○ inactive.
    expect(await runCrewCommand(repo, ["list"])).toMatch(/^✗ /m);

    expect(await runCrewCommand(repo, ["unarchive", "crew-eric"])).toMatch(/back in the ask pool/i);
    expect((await repo.getCrewMember(eric))!.status).toBe("active");

    await expect(runCrewCommand(repo, ["archive", "crew-ghost"])).rejects.toThrow(/no crew member/i);
    await expect(runCrewCommand(repo, ["archive"])).rejects.toThrow(/a crew id is required/i);
    await expect(runCrewCommand(repo, ["archive", "crew-eric", "--typo=1"])).rejects.toThrow(
      /unexpected argument/i,
    );
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

  it("set rejects an email already on another crew member (login-collision guard)", async () => {
    await repo.saveCrewMember(crew({ id: asId<"CrewMemberId">("crew-quint"), email: "shared@x.com" }));
    await expect(
      runCrewCommand(repo, ["set", "crew-eric", "--email=Shared@x.com"]),
    ).rejects.toThrow(/already on crew-quint/i);
    // the target's email was not changed
    expect((await repo.getCrewMember(asId<"CrewMemberId">("crew-eric")))!.email).toBeUndefined();
    // ...but re-setting a crew's own email to what it already has is fine (no self-clash)
    await runCrewCommand(repo, ["set", "crew-quint", "--email=shared@x.com"]);
    expect((await repo.getCrewMember(asId<"CrewMemberId">("crew-quint")))!.email).toBe("shared@x.com");
  });

  it("set rejects a mistyped flag rather than silently no-op it", async () => {
    await expect(
      runCrewCommand(repo, ["set", "crew-eric", "--pone=+15035550123"]),
    ).rejects.toThrow(/unrecognized flag "--pone=\+15035550123"/i);
    // a flag missing its "=" is caught too
    await expect(
      runCrewCommand(repo, ["set", "crew-eric", "--phone"]),
    ).rejects.toThrow(/unrecognized flag/i);
  });

  it("set leaves engine-owned fields alone (targeted update, DEC-094)", async () => {
    await repo.saveCrewMember(crew({ reliabilityScore: 9, manualBoost: 2 }));
    await runCrewCommand(repo, ["set", "crew-eric", "--phone=+15035550123"]);
    const c = await repo.getCrewMember(asId<"CrewMemberId">("crew-eric"));
    expect(c).toMatchObject({ phone: "+15035550123", reliabilityScore: 9, manualBoost: 2 });
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

  describe("days-off (#411, DEC-119)", () => {
    it("sets, shows, and clears the recurring weekday-off set (deduped, sorted)", async () => {
      const set = await runCrewCommand(repo, ["days-off", "crew-eric", "--days=sun,sat,sun"]);
      expect(set).toMatch(/is now off: sat, sun/);
      expect((await repo.getCrewMember(asId<"CrewMemberId">("crew-eric")))!.weekdaysOff).toEqual([5, 6]);

      expect(await runCrewCommand(repo, ["days-off", "crew-eric"])).toMatch(/is off: sat, sun/);

      const cleared = await runCrewCommand(repo, ["days-off", "crew-eric", "--clear"]);
      expect(cleared).toMatch(/Cleared recurring days off/);
      const after = (await repo.getCrewMember(asId<"CrewMemberId">("crew-eric")))!;
      expect(after.weekdaysOff ?? []).toEqual([]); // cleared ⇒ omitted (never off)
    });

    it("shows 'no recurring days off' before any are set", async () => {
      expect(await runCrewCommand(repo, ["days-off", "crew-eric"])).toMatch(/no recurring days off/);
    });

    it("no-id lists only crew who have days off, sorted by name", async () => {
      await repo.saveCrewMember(crew({ id: asId<"CrewMemberId">("crew-abe"), name: "Abe" }));
      // Nobody off yet.
      expect(await runCrewCommand(repo, ["days-off"])).toMatch(/No crew have recurring days off/);
      // Give two of them days off.
      await runCrewCommand(repo, ["days-off", "crew-eric", "--days=sun"]);
      await runCrewCommand(repo, ["days-off", "crew-abe", "--days=mon,fri"]);
      const out = await runCrewCommand(repo, ["days-off"]);
      expect(out).toMatch(/crew-abe.*Abe.*mon, fri/);
      expect(out).toMatch(/crew-eric.*Eric Stoffer.*sun/);
      expect(out.indexOf("Abe")).toBeLessThan(out.indexOf("Eric")); // sorted by name
    });

    it("warns when off all seven days (soft bench, not archived)", async () => {
      const out = await runCrewCommand(repo, [
        "days-off",
        "crew-eric",
        "--days=mon,tue,wed,thu,fri,sat,sun",
      ]);
      expect(out).toMatch(/off every weekday/i);
    });

    it("does NOT touch reliability/status (targeted update, DEC-094)", async () => {
      await repo.saveCrewMember(
        crew({ id: asId<"CrewMemberId">("crew-x"), reliabilityScore: 7, status: "inactive" }),
      );
      await runCrewCommand(repo, ["days-off", "crew-x", "--days=sun"]);
      const c = (await repo.getCrewMember(asId<"CrewMemberId">("crew-x")))!;
      expect(c.weekdaysOff).toEqual([6]);
      expect(c.reliabilityScore).toBe(7);
      expect(c.status).toBe("inactive");
    });

    it("rejects an unknown weekday, an unknown flag, a missing id, both flags, and a ghost", async () => {
      await expect(runCrewCommand(repo, ["days-off", "crew-eric", "--days=funday"])).rejects.toThrow(
        /isn't a weekday/i,
      );
      await expect(runCrewCommand(repo, ["days-off", "crew-eric", "--day=sun"])).rejects.toThrow(
        /unrecognized flag/i,
      );
      // Space instead of comma (`--days=sun mon`) → "mon" is a stray token, rejected.
      await expect(runCrewCommand(repo, ["days-off", "crew-eric", "--days=sun", "mon"])).rejects.toThrow(
        /unexpected argument "mon".*comma-separated/i,
      );
      await expect(runCrewCommand(repo, ["days-off", "--days=sun"])).rejects.toThrow(
        /a crew id is required/i,
      );
      await expect(
        runCrewCommand(repo, ["days-off", "crew-eric", "--days=sun", "--clear"]),
      ).rejects.toThrow(/not both/i);
      await expect(runCrewCommand(repo, ["days-off", "crew-ghost", "--days=sun"])).rejects.toThrow(
        /no crew member/i,
      );
    });
  });
});
