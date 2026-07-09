import { describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "./in-memory-repository.js";
import { memoizingRepo } from "./memoizing-repo.js";
import { asId } from "../domain/ids.js";
import type { CrewMember } from "../domain/entities.js";

const crew = (id: string): CrewMember => ({
  id: asId<"CrewMemberId">(id),
  name: id,
  phone: "555",
  ratings: [asId<"RoleTypeId">("role-captain")],
  status: "active",
  reliabilityScore: null,
});

describe("memoizingRepo (#316)", () => {
  it("memoizes a keyed read — same id hits the repo once, different ids each once", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("a"));
    const spy = vi.spyOn(repo, "reliabilityEventsFor");
    const cached = memoizingRepo(repo);

    const first = await cached.reliabilityEventsFor(asId<"CrewMemberId">("a"));
    const second = await cached.reliabilityEventsFor(asId<"CrewMemberId">("a"));
    await cached.reliabilityEventsFor(asId<"CrewMemberId">("b"));

    expect(spy).toHaveBeenCalledTimes(2); // a once + b once — NOT three
    expect(second).toBe(first); // the memoized promise resolves to the same value
  });

  it("memoizes a single-slot read (listCrewMembers) across calls", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("a"));
    const spy = vi.spyOn(repo, "listCrewMembers");
    const cached = memoizingRepo(repo);

    await cached.listCrewMembers();
    await cached.listCrewMembers();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("delegates uncached methods to the real repo (writes land, this stays bound)", async () => {
    const repo = new InMemoryRepository();
    const cached = memoizingRepo(repo);

    await cached.saveCrewMember(crew("z"));
    // Read back through the UNWRAPPED repo — the write reached the real store.
    expect((await repo.getCrewMember(asId<"CrewMemberId">("z")))!.name).toBe("z");
  });
});
