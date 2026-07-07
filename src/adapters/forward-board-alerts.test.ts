import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { Admin, CrewMember } from "../domain/entities.js";
import type { OutboundMessage, SendResult } from "../ports/channel.js";
import { FakeChannel } from "./fake-channel.js";
import { InMemoryRepository } from "./in-memory-repository.js";
import {
  composeBoardAlert,
  forwardBoardAlerts,
  listActiveAdminRecipients,
} from "./forward-board-alerts.js";

const NOW = new Date("2026-07-07T12:00:00.000Z");
const LINK = "https://muster.example/admin/at-risk";

async function seedAdmin(
  repo: InMemoryRepository,
  id: string,
  opts: { active?: boolean; phone?: string } = {},
): Promise<void> {
  const { active = true, phone = "+12165550001" } = opts;
  const crew: CrewMember = {
    id: asId<"CrewMemberId">(id),
    name: id,
    phone,
    ratings: [],
    status: "active",
    reliabilityScore: null,
  };
  await repo.saveCrewMember(crew);
  const admin: Admin = {
    id,
    handle: id,
    name: id,
    active,
    createdAt: NOW.toISOString(),
    deactivatedAt: active ? null : NOW.toISOString(),
  };
  await repo.saveAdmin(admin);
}

async function seedShift(repo: InMemoryRepository): Promise<void> {
  await repo.saveVessel({ id: asId<"VesselId">("v1"), name: "Hops", coiMaxPax: 12, manning: [] });
  await repo.saveShift({
    id: asId<"ShiftId">("shift-1"),
    vesselId: asId<"VesselId">("v1"),
    date: "2026-07-11",
    state: "AtRisk",
    eventIds: [asId<"EventId">("e1")],
  });
}

describe("forwardBoardAlerts (DEC-095)", () => {
  it("texts every active admin with a phone; skips inactive + phoneless", async () => {
    const repo = new InMemoryRepository();
    await seedShift(repo);
    await seedAdmin(repo, "admin-a", { phone: "+12165550001" });
    await seedAdmin(repo, "admin-b", { phone: "+12165550002" });
    await seedAdmin(repo, "admin-off", { active: false, phone: "+12165550003" });
    await seedAdmin(repo, "admin-nophone", { phone: "" });

    const ch = new FakeChannel(() => NOW);
    const sent = await forwardBoardAlerts(repo, ch, [{ shiftId: "shift-1", reason: "core" }], LINK);

    expect(sent).toBe(2);
    const phones = ch.sent.map((m) => m.to.phone).sort();
    expect(phones).toEqual(["+12165550001", "+12165550002"]);
    expect(ch.sent.every((m) => m.kind === "admin_alert")).toBe(true);
    expect(ch.sent[0]!.link).toBe(LINK);
  });

  it("composes date · vessel — reason, grouping reasons per shift", async () => {
    const repo = new InMemoryRepository();
    await seedShift(repo);
    const body = await composeBoardAlert(repo, [
      { shiftId: "shift-1", reason: "regression" },
      { shiftId: "shift-1", reason: "credential_lapse" },
    ]);
    expect(body).toContain("1 shift needs you");
    expect(body).toContain("Jul 11 · Hops");
    expect(body).toContain("someone bailed + credential lapse");
  });

  it("falls back gracefully when the shift/vessel can't be resolved", async () => {
    const repo = new InMemoryRepository();
    const body = await composeBoardAlert(repo, [{ shiftId: "ghost", reason: "core" }]);
    expect(body).toContain("a shift — needs crew");
  });

  it("is best-effort: one failed send doesn't drop the others", async () => {
    const repo = new InMemoryRepository();
    await seedShift(repo);
    await seedAdmin(repo, "admin-a", { phone: "+12165550001" });
    await seedAdmin(repo, "admin-b", { phone: "+12165550002" });
    // A channel that throws for admin-a's number only.
    const good: OutboundMessage[] = [];
    const flaky = {
      async send(m: OutboundMessage): Promise<SendResult> {
        if (m.to.phone === "+12165550001") throw new Error("carrier reject");
        good.push(m);
        return { deliveredAt: NOW.toISOString() };
      },
    };
    const sent = await forwardBoardAlerts(repo, flaky, [{ shiftId: "shift-1", reason: "core" }], LINK);
    expect(sent).toBe(1);
    expect(good.map((m) => m.to.phone)).toEqual(["+12165550002"]);
  });

  it("no landings or no recipients → zero sends", async () => {
    const repo = new InMemoryRepository();
    const ch = new FakeChannel(() => NOW);
    expect(await forwardBoardAlerts(repo, ch, [], LINK)).toBe(0);
    // landings but no admins
    expect(await forwardBoardAlerts(repo, ch, [{ shiftId: "shift-1", reason: "core" }], LINK)).toBe(0);
    expect(ch.sent).toHaveLength(0);
  });

  it("listActiveAdminRecipients returns only active, phone-bearing admins", async () => {
    const repo = new InMemoryRepository();
    await seedAdmin(repo, "admin-a", { phone: "+12165550001" });
    await seedAdmin(repo, "admin-off", { active: false });
    await seedAdmin(repo, "admin-nophone", { phone: "" });
    const r = await listActiveAdminRecipients(repo);
    expect(r.map((x) => x.crewMemberId)).toEqual([asId<"CrewMemberId">("admin-a")]);
  });
});
