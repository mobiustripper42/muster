/**
 * The doorbell decider's behavior spec (#114, Phase 6.4) — the heavy unit suite
 * the 6.5 harness layers human-drivable simulation on top of. One assertion per
 * artifact §7 rule, plus the DEC-068 three-state presence contract and the DEC-060
 * cross-field invariant.
 */

import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, ThreadId } from "../domain/ids.js";
import type { Subject } from "../domain/entities.js";
import {
  decideNotifications,
  makeDoorbellRules,
  memberThreadKey,
  type DoorbellInput,
  type DoorbellRules,
  type NotificationDecision,
  type PendingMessage,
  type PresenceState,
} from "./doorbell-decider.js";

// ── fixtures ──

const T = asId<"ThreadId">("thread-cohort-t1-2026-07-04");
const T2 = asId<"ThreadId">("thread-shift-t1-shift-9");
const ALICE = asId<"CrewMemberId">("crew-alice");
const BOB = asId<"CrewMemberId">("crew-bob");

const NOW = "2026-07-04T12:00:00.000Z";
const AGED = "2026-07-04T11:58:00.000Z"; // 2 min before NOW — past the 90s batch window
const RECENT = "2026-07-04T11:59:45.000Z"; // 15s before NOW — inside the batch window

const RULES: DoorbellRules = {
  batchWindowMs: 90_000,
  presenceWindowMs: 300_000,
  shortNoticeMaxChars: 160,
};

const crew = (id: CrewMemberId): Subject => ({ kind: "crew", id: String(id) });

let seq = 0;
const msg = (over: Partial<PendingMessage> = {}): PendingMessage => ({
  id: asId<"MessageId">(`msg-${++seq}`),
  threadId: T,
  senderId: "crew-zoe", // a third party by default — neither Alice nor Bob
  senderKind: "crew",
  body: "dock's at slip B",
  createdAt: AGED,
  priority: false,
  ...over,
});

interface Setup {
  messages?: PendingMessage[];
  members?: Map<ThreadId, CrewMemberId[]>;
  presence?: Array<[ThreadId, Subject, PresenceState]>;
  read?: Array<[ThreadId, Subject, string]>;
  notify?: Array<[ThreadId, Subject, string]>;
  now?: string;
  rules?: DoorbellRules;
}

const run = (s: Setup = {}): NotificationDecision[] => {
  const presence = new Map<string, PresenceState>();
  for (const [t, subj, st] of s.presence ?? []) presence.set(memberThreadKey(t, subj), st);
  const readState = new Map<string, string>();
  for (const [t, subj, at] of s.read ?? []) readState.set(memberThreadKey(t, subj), at);
  const notifyState = new Map<string, string>();
  for (const [t, subj, at] of s.notify ?? []) notifyState.set(memberThreadKey(t, subj), at);
  const input: DoorbellInput = {
    pendingMessages: s.messages ?? [msg()],
    threadMembers: s.members ?? new Map([[T, [ALICE]]]),
    presence,
    readState,
    notifyState,
    rules: s.rules ?? RULES,
    now: s.now ?? NOW,
  };
  return decideNotifications(input);
};

const forSubject = (ds: NotificationDecision[], id: CrewMemberId): NotificationDecision => {
  const d = ds.find((x) => x.subject.id === String(id));
  if (!d) throw new Error(`no decision for ${id}`);
  return d;
};

// ── DEC-060 cross-field invariant (the 6.3 → 6.4 handoff) ──

describe("makeDoorbellRules", () => {
  it("returns rules when presence window exceeds the batch window", () => {
    expect(makeDoorbellRules(RULES)).toEqual(RULES);
  });
  it("throws when the presence window does not exceed the batch window", () => {
    expect(() => makeDoorbellRules({ ...RULES, presenceWindowMs: 90_000 })).toThrow(/invariant/);
    expect(() => makeDoorbellRules({ ...RULES, presenceWindowMs: 1_000 })).toThrow(/invariant/);
  });
  it("throws on a negative short-notice threshold", () => {
    expect(() => makeDoorbellRules({ ...RULES, shortNoticeMaxChars: -1 })).toThrow(/shortNotice/);
  });
});

// ── §7.1 / §7.6 presence (DEC-068 three-state) ──

describe("presence suppression (§7.1 / §7.6, DEC-068)", () => {
  it("present_here → suppressed entirely: no ring, no toast", () => {
    const d = forSubject(run({ presence: [[T, crew(ALICE), "present_here"]] }), ALICE);
    expect(d).toMatchObject({ channel: "none", ring: false, mode: null, reason: "present_suppressed" });
  });

  it("present_elsewhere → in-app toast, never an SMS", () => {
    const d = forSubject(run({ presence: [[T, crew(ALICE), "present_elsewhere"]] }), ALICE);
    expect(d).toMatchObject({ channel: "in_app_toast", ring: false, reason: "present_toast" });
  });

  it("absent (never seen → omitted from the map) rings — fail toward ringing", () => {
    const d = forSubject(run(), ALICE); // no presence entry at all
    expect(d.ring).toBe(true);
    expect(d.reason).toBe("batched");
  });

  it("a present member's count is still reported (for the in-app badge)", () => {
    const d = forSubject(
      run({ messages: [msg(), msg()], presence: [[T, crew(ALICE), "present_elsewhere"]] }),
      ALICE,
    );
    expect(d.messageCount).toBe(2);
  });
});

// ── §7.2 batch / cancel window ──

describe("batch / cancel window (§7.2)", () => {
  it("rings once the oldest unread has aged past the window", () => {
    const d = forSubject(run({ messages: [msg({ createdAt: AGED })] }), ALICE);
    expect(d).toMatchObject({ channel: "sms", ring: true, reason: "batched" });
  });

  it("holds while the flurry is still inside the window", () => {
    const d = forSubject(run({ messages: [msg({ createdAt: RECENT })] }), ALICE);
    expect(d).toMatchObject({ channel: "none", ring: false, reason: "within_batch_window" });
  });

  it("ages off the OLDEST unread, batching newer ones into the same ring", () => {
    const d = forSubject(
      run({ messages: [msg({ createdAt: AGED }), msg({ createdAt: RECENT })] }),
      ALICE,
    );
    expect(d.reason).toBe("batched");
    expect(d.messageCount).toBe(2);
  });

  it("cancel-on-read: reading inside the window leaves nothing unread → no ring", () => {
    const d = forSubject(
      run({ messages: [msg({ createdAt: AGED })], read: [[T, crew(ALICE), NOW]] }),
      ALICE,
    );
    expect(d).toMatchObject({ ring: false, reason: "all_read", messageCount: 0 });
  });
});

// ── §7.3 first-only-until-read ──

describe("first-only-until-read (§7.3)", () => {
  it("holds a thread already rung and not yet read again", () => {
    const d = forSubject(
      run({ messages: [msg({ createdAt: AGED })], notify: [[T, crew(ALICE), "2026-07-04T11:59:00.000Z"]] }),
      ALICE,
    );
    expect(d).toMatchObject({ ring: false, reason: "already_notified" });
  });

  it("holds even when they have never read (don't nag the absent)", () => {
    // rang at 11:59, no read-state at all, message still pending
    const d = forSubject(
      run({ messages: [msg({ createdAt: AGED })], notify: [[T, crew(ALICE), "2026-07-04T11:59:00.000Z"]] }),
      ALICE,
    );
    expect(d.reason).toBe("already_notified");
  });

  it("re-arms after a read: a fresh message past the window rings again", () => {
    // rang at 11:55, read at 11:56, a new message at 11:58 (aged), now 12:00
    const d = forSubject(
      run({
        messages: [msg({ createdAt: AGED })],
        notify: [[T, crew(ALICE), "2026-07-04T11:55:00.000Z"]],
        read: [[T, crew(ALICE), "2026-07-04T11:56:00.000Z"]],
      }),
      ALICE,
    );
    expect(d).toMatchObject({ ring: true, reason: "batched" });
  });
});

// ── §7.4 priority jump ──

describe("priority jump (§7.4)", () => {
  it("a priority message rings now, bypassing the batch window", () => {
    const d = forSubject(run({ messages: [msg({ createdAt: RECENT, priority: true })] }), ALICE);
    expect(d).toMatchObject({ ring: true, reason: "priority_bypass" });
  });

  it("a NEW priority bypasses first-only-until-read (rings through a held thread)", () => {
    // already rang at 11:59; a priority arrives at 11:59:45 (after the ring) → rings through
    const d = forSubject(
      run({
        messages: [msg({ createdAt: RECENT, priority: true })],
        notify: [[T, crew(ALICE), "2026-07-04T11:59:00.000Z"]],
      }),
      ALICE,
    );
    expect(d.reason).toBe("priority_bypass");
  });

  it("a priority we already rang for does NOT re-ring", () => {
    // priority message at 11:58, rang at 11:59 (after it) → no new priority → held
    const d = forSubject(
      run({
        messages: [msg({ createdAt: AGED, priority: true })],
        notify: [[T, crew(ALICE), "2026-07-04T11:59:00.000Z"]],
      }),
      ALICE,
    );
    expect(d.reason).toBe("already_notified");
  });

  it("a present member is never rung, even for a priority (present means looking)", () => {
    const d = forSubject(
      run({
        messages: [msg({ priority: true })],
        presence: [[T, crew(ALICE), "present_elsewhere"]],
      }),
      ALICE,
    );
    expect(d).toMatchObject({ channel: "in_app_toast", ring: false });
  });
});

// ── §7.5 short-notice-as-text ──

describe("short-notice-as-text (§7.5)", () => {
  it("a lone short note carries its body inline (mode: content)", () => {
    const d = forSubject(run({ messages: [msg({ body: "slip B, call 12:30" })] }), ALICE);
    expect(d).toMatchObject({ ring: true, mode: "content", messageCount: 1 });
  });

  it("a lone long note summarizes (mode: summary)", () => {
    const d = forSubject(
      run({ messages: [msg({ body: "x".repeat(RULES.shortNoticeMaxChars + 1) })] }),
      ALICE,
    );
    expect(d.mode).toBe("summary");
  });

  it("a body exactly at the threshold still carries inline", () => {
    const d = forSubject(
      run({ messages: [msg({ body: "x".repeat(RULES.shortNoticeMaxChars) })] }),
      ALICE,
    );
    expect(d.mode).toBe("content");
  });

  it("a flurry summarizes regardless of length (one ping, N new)", () => {
    const d = forSubject(
      run({ messages: [msg({ body: "a" }), msg({ body: "b" })] }),
      ALICE,
    );
    expect(d).toMatchObject({ mode: "summary", messageCount: 2 });
  });

  it("a holding decision has no mode", () => {
    const d = forSubject(run({ messages: [msg({ createdAt: RECENT })] }), ALICE);
    expect(d.mode).toBeNull();
  });
});

// ── §7.1 sender exclusion ──

describe("sender exclusion (§7.1 swarm-fear)", () => {
  it("does not count a recipient's own message as unread", () => {
    const d = forSubject(
      run({ messages: [msg({ senderKind: "crew", senderId: String(ALICE) })] }),
      ALICE,
    );
    expect(d).toMatchObject({ ring: false, reason: "all_read", messageCount: 0 });
  });

  it("still rings the other members for that same message", () => {
    const ds = run({
      messages: [msg({ senderId: String(ALICE) })],
      members: new Map([[T, [ALICE, BOB]]]),
    });
    expect(forSubject(ds, ALICE).reason).toBe("all_read");
    expect(forSubject(ds, BOB).ring).toBe(true);
  });
});

// ── totality / fan-out ──

describe("totality and fan-out", () => {
  it("emits exactly one decision per (thread, member)", () => {
    const ds = run({ members: new Map([[T, [ALICE, BOB]]]) });
    expect(ds).toHaveLength(2);
    expect(ds.map((d) => d.subject.id).sort()).toEqual([String(ALICE), String(BOB)].sort());
  });

  it("de-dupes a member listed twice in one thread (never a double ring)", () => {
    const ds = run({ members: new Map([[T, [ALICE, ALICE]]]) });
    expect(ds).toHaveLength(1);
  });

  it("decides each member independently: present toasts while absent rings", () => {
    const ds = run({
      members: new Map([[T, [ALICE, BOB]]]),
      presence: [[T, crew(ALICE), "present_elsewhere"]], // Bob absent
    });
    expect(forSubject(ds, ALICE).channel).toBe("in_app_toast");
    expect(forSubject(ds, BOB).channel).toBe("sms");
  });

  it("decides per thread: same person, two threads, different outcomes", () => {
    const ds = run({
      messages: [msg({ threadId: T, createdAt: AGED }), msg({ threadId: T2, createdAt: RECENT })],
      members: new Map([
        [T, [ALICE]],
        [T2, [ALICE]],
      ]),
    });
    expect(ds.find((d) => d.threadId === T)?.reason).toBe("batched");
    expect(ds.find((d) => d.threadId === T2)?.reason).toBe("within_batch_window");
  });

  it("ring is true only for an SMS — never for a toast or a hold", () => {
    const ds = run({
      members: new Map([[T, [ALICE, BOB]]]),
      presence: [[T, crew(ALICE), "present_elsewhere"]],
    });
    for (const d of ds) expect(d.ring).toBe(d.channel === "sms");
  });

  it("carries messageIds for the messages a decision covers", () => {
    const m1 = msg({ createdAt: AGED });
    const m2 = msg({ createdAt: AGED });
    const d = forSubject(run({ messages: [m1, m2] }), ALICE);
    expect(d.messageIds).toEqual([m1.id, m2.id]);
  });
});
