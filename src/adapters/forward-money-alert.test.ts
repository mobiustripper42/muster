/**
 * Money alerts to the office (issue #723).
 *
 * The behaviour worth pinning is not "a message was composed" — it is that the operator is
 * actually reachable, that one bad number cannot mute the rest, and that the webhook survives
 * every failure mode here. A money alert that throws takes a Stripe webhook to a 500, which
 * Stripe answers with a redelivery loop.
 */
import { describe, expect, it } from "vitest";
import type { Admin, CrewMember } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { OutboundMessage, SendResult } from "../ports/channel.js";
import { FakeChannel } from "./fake-channel.js";
import { forwardMoneyAlert } from "./forward-money-alert.js";
import { InMemoryRepository } from "./in-memory-repository.js";

const NOW = "2026-08-19T12:00:00.000Z";
const LINK = "https://muster.example/admin/purchases";
/** Verbatim from `booking-webhook.ts` — the copy that actually ships. */
const REAL_ALERT =
  "Refund of 53625 cents recorded in Stripe for payment intent pi_3KxY9aB2eZvKYlo2C8b9Xq1F, " +
  "which matches NO payment in Muster - RECONCILE MANUALLY.";

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

describe("forwardMoneyAlert (issue #723)", () => {
  it("texts every active admin and reports how many landed", async () => {
    const repo = new InMemoryRepository();
    await seedAdmin(repo, "eric");
    await seedAdmin(repo, "drew", { phone: "+12165550002" });
    await seedAdmin(repo, "retired", { active: false });
    const channel = new FakeChannel();

    const sent = await forwardMoneyAlert(repo, channel, "PAID but NOT booked", LINK);

    expect(sent).toBe(2);
    expect(channel.sent.map((m) => m.to.phone).sort()).toEqual(["+12165550001", "+12165550002"]);
    expect(channel.sent[0]!.kind).toBe("admin_alert");
    expect(channel.sent[0]!.link).toBe(LINK);
  });

  it("sends the body through intact, ids and all", async () => {
    // The ids are the part nobody can reconstruct from memory, and they sit at the end of the
    // sentence where a phone's notification preview truncates.
    const repo = new InMemoryRepository();
    await seedAdmin(repo, "eric");
    const channel = new FakeChannel();

    await forwardMoneyAlert(repo, channel, REAL_ALERT, LINK);

    const body = channel.sent[0]!.body;
    expect(body).toContain("pi_3KxY9aB2eZvKYlo2C8b9Xq1F");
    expect(body).toContain("53625");
  });

  it("one dead number cannot mute the other admins", async () => {
    const repo = new InMemoryRepository();
    await seedAdmin(repo, "eric");
    await seedAdmin(repo, "drew", { phone: "+12165550002" });
    const channel = new FakeChannel();
    const realSend = channel.send.bind(channel);
    channel.send = async (m: OutboundMessage): Promise<SendResult> => {
      if (m.to.phone === "+12165550001") throw new Error("carrier rejected");
      return realSend(m);
    };

    const sent = await forwardMoneyAlert(repo, channel, "PAID but NOT booked", LINK);

    expect(sent).toBe(1);
  });

  it("returns 0 rather than throwing when there is nobody to tell", async () => {
    // No admins at all, and an admin with no phone: both are "nobody reachable", and neither is
    // an error the webhook should hear about — the caller's log line is the floor.
    const repo = new InMemoryRepository();
    expect(await forwardMoneyAlert(repo, new FakeChannel(), "x", LINK)).toBe(0);

    await seedAdmin(repo, "phoneless", { phone: "" });
    expect(await forwardMoneyAlert(repo, new FakeChannel(), "x", LINK)).toBe(0);
  });

  it("swallows a repository outage — the webhook must not 500 over a failed alert", async () => {
    // A throw here becomes a 500, and a 500 becomes a Stripe redelivery loop against a ledger
    // write that already succeeded.
    const repo = new InMemoryRepository();
    repo.listAdmins = async () => {
      throw new Error("db is down");
    };

    await expect(forwardMoneyAlert(repo, new FakeChannel(), "x", LINK)).resolves.toBe(0);
  });
});
