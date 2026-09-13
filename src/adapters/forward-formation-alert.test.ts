/**
 * A vessel-day that fails to form texts the office (#1001).
 *
 * **The failure this closes is a sold trip with nobody on it.** Since #957 a bad vessel-day no
 * longer aborts the run — it lands in `FormResult.failures` and the tick writes a `console.error`.
 * A log line is not somebody finding out. Nobody reads a log that prints the same thing every
 * fifteen minutes; you go and read it after someone has already told you a boat had no crew.
 *
 * **No dedup, and that is the decision, not an omission.** The operator's ruling 2026-09-13: one
 * text about an unformed shift is a drop-everything, so the repeats are self-limiting — and if it
 * ever floods, the flood IS the report. A stateful alert is one that can go quiet at the wrong
 * moment, which is exactly what this issue's title complains about.
 */
import { describe, expect, it } from "vitest";
import type { Admin, CrewMember } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { OutboundMessage } from "../ports/channel.js";
import { FakeChannel } from "./fake-channel.js";
import { forwardFormationAlert } from "./forward-formation-alert.js";
import { InMemoryRepository } from "./in-memory-repository.js";
import { nonGsm7Chars } from "../reservations/sms-alphabet.js";

const NOW = "2026-09-13T12:00:00.000Z";
const LINK = "https://muster.example/admin/shifts";
const BREW3 = asId<"VesselId">("vessel-brew-3");

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
    createdAt: NOW,
    deactivatedAt: active ? null : NOW,
  };
  await repo.saveAdmin(admin);
}

const failure = (date: string) => ({
  vesselId: BREW3,
  date,
  error: new Error("Shift has no required seats — the vessel has no manning rule (#582)."),
});

describe("forwardFormationAlert (#1001)", () => {
  it("names the boat and the date, so the operator knows where to look", async () => {
    // The whole point. "Formation failed" tells you something is wrong; "Brew 3 on Sat Sep 13"
    // tells you which trip has nobody on it, which is the only thing you can act on.
    const repo = new InMemoryRepository();
    await repo.saveVessel({ id: BREW3, name: "Brew 3", coiMaxPax: 12, manning: [] });
    await seedAdmin(repo, "eric");
    const channel = new FakeChannel();

    const sent = await forwardFormationAlert(repo, channel, [failure("2026-09-13")], LINK);

    expect(sent).toBe(1);
    const body = (channel.sent[0] as OutboundMessage).body;
    expect(body).toContain("Brew 3");
    expect(body).toContain("Sun, Sep 13");
    expect((channel.sent[0] as OutboundMessage).kind).toBe("admin_alert");
    // GSM-7 or the whole message re-encodes as UCS-2 and every send costs two segments instead of
    // one — the #619/#685 defect. The vessel NAME is interpolated tenant data, so it is passed as
    // an allowed token: a boat with an accented name is the operator's business, the template is
    // ours, and only the template is ours to keep clean.
    expect(nonGsm7Chars(body, ["Brew 3"])).toEqual([]);
  });

  it("sends nothing when nothing failed", async () => {
    // A healthy tick is silent. An alert that fires on a good day is one you stop reading.
    const repo = new InMemoryRepository();
    await seedAdmin(repo, "eric");
    const channel = new FakeChannel();

    expect(await forwardFormationAlert(repo, channel, [], LINK)).toBe(0);
    expect(channel.sent).toHaveLength(0);
  });

  it("texts every active admin, once per independently-failed vessel-day", async () => {
    // Two admins, two bad days with DIFFERENT causes: four messages. Naming each boat is the
    // actionable half — a count would tell the operator a number instead of where to look.
    //
    // The distinct errors are load-bearing. An earlier version of this fixture gave both days the
    // same error and expected four messages, which the grouping below correctly collapsed to two.
    // The fixture was wrong, not the grouping.
    const repo = new InMemoryRepository();
    await repo.saveVessel({ id: BREW3, name: "Brew 3", coiMaxPax: 12, manning: [] });
    await seedAdmin(repo, "eric");
    await seedAdmin(repo, "drew", { phone: "+12165550002" });
    await seedAdmin(repo, "retired", { active: false });
    const channel = new FakeChannel();

    const sent = await forwardFormationAlert(
      repo,
      channel,
      [
        { vesselId: BREW3, date: "2026-09-13", error: new Error("no manning rule") },
        { vesselId: BREW3, date: "2026-09-14", error: new Error("a different problem") },
      ],
      LINK,
    );

    expect(sent).toBe(4);
    const phones = new Set(channel.sent.map((m) => m.to.phone));
    expect(phones).toEqual(new Set(["+12165550001", "+12165550002"]));
  });

  it("many vessel-days with ONE cause is one outage, not one text each (#1001)", async () => {
    // `FormResult.failures`' own docstring sets this obligation and names this issue as owing it:
    // "Many entries carrying the SAME error is one outage, not N data problems, and #1001 should
    // say so rather than fan out that many leads."
    //
    // This is NOT the no-dedup case DEC-172 settled. That one is the same vessel-day repeating
    // across ticks, and the repeats are self-limiting because you fix it. This is a dead pool
    // failing every vessel-day in the fleet inside ONE tick — admins × fleet-size texts that all
    // say the same thing, which buries the one fact that matters: the system is down.
    const repo = new InMemoryRepository();
    await repo.saveVessel({ id: BREW3, name: "Brew 3", coiMaxPax: 12, manning: [] });
    await seedAdmin(repo, "eric");
    const channel = new FakeChannel();
    const outage = new Error("pool exhausted");
    const sameCause = ["2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16"].map((date) => ({
      vesselId: BREW3,
      date,
      error: outage,
    }));

    const sent = await forwardFormationAlert(repo, channel, sameCause, LINK);

    expect(sent).toBe(1);
    const body = (channel.sent[0] as OutboundMessage).body;
    expect(body).toContain("4 vessel-days");
    expect(body).toContain("pool exhausted");
  });

  it("distinct causes still fan out — they are distinct problems", async () => {
    // The other half. Two boats broken for two different reasons are two leads, and collapsing
    // them would hide one of them. Only a SHARED cause is one outage.
    const repo = new InMemoryRepository();
    await repo.saveVessel({ id: BREW3, name: "Brew 3", coiMaxPax: 12, manning: [] });
    await seedAdmin(repo, "eric");
    const channel = new FakeChannel();

    const sent = await forwardFormationAlert(
      repo,
      channel,
      [
        { vesselId: BREW3, date: "2026-09-13", error: new Error("no manning rule") },
        { vesselId: BREW3, date: "2026-09-14", error: new Error("something else entirely") },
      ],
      LINK,
    );

    expect(sent).toBe(2);
  });

  it("one dead number cannot mute the rest", async () => {
    // Same posture as the money alert: best-effort per recipient. An admin whose carrier rejects
    // must not swallow the alert for everyone else, on the one message that means a boat is uncrewed.
    const repo = new InMemoryRepository();
    await repo.saveVessel({ id: BREW3, name: "Brew 3", coiMaxPax: 12, manning: [] });
    await seedAdmin(repo, "bad", { phone: "+15550000000" });
    await seedAdmin(repo, "good", { phone: "+12165550002" });
    const channel = new FakeChannel();
    const real = channel.send.bind(channel);
    channel.send = async (m: OutboundMessage) => {
      if (m.to.phone === "+15550000000") throw new Error("carrier rejected");
      return real(m);
    };

    expect(await forwardFormationAlert(repo, channel, [failure("2026-09-13")], LINK)).toBe(1);
  });

  it("never throws — the tick's own response must survive a dead repo", async () => {
    // It runs inside the cron route beside the engine's own work. An alert that throws turns
    // "one vessel-day did not form" into "the tick failed", which is strictly worse.
    const repo = new InMemoryRepository();
    repo.listAdmins = async () => {
      throw new Error("pool exhausted");
    };
    const channel = new FakeChannel();

    expect(await forwardFormationAlert(repo, channel, [failure("2026-09-13")], LINK)).toBe(0);
  });

  it("still names the vessel id when the vessel row cannot be read", async () => {
    // Degrade to the id rather than to silence: an unreadable vessel is not a reason to stop
    // telling somebody a boat has no crew, and the id is still enough to find it.
    const repo = new InMemoryRepository();
    await seedAdmin(repo, "eric");
    const channel = new FakeChannel();

    const sent = await forwardFormationAlert(repo, channel, [failure("2026-09-13")], LINK);

    expect(sent).toBe(1);
    expect((channel.sent[0] as OutboundMessage).body).toContain(String(BREW3));
  });
});
