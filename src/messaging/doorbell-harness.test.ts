/**
 * The doorbell harness as the decider's observable-behavior spec (#115, 6.5):
 * a multi-crew Saturday-morning walkthrough (artifact §9) driven step by step,
 * asserting who rings vs stays silent, what batches, what jumps on priority, and
 * what's toast vs SMS — the invisible logic made observable. Plus the command
 * parser the REPL + scenarios share.
 */

import { describe, expect, it } from "vitest";
import type { NotificationDecision } from "./doorbell-decider.js";
import { DoorbellHarness, parseDuration } from "./doorbell-harness.js";

const find = (ds: NotificationDecision[], thread: string, crew: string): NotificationDecision => {
  const d = ds.find((x) => String(x.threadId) === thread && x.subject.id === crew);
  if (!d) throw new Error(`no decision for ${crew}@${thread}`);
  return d;
};

describe("Saturday-morning walkthrough (the observable spec)", () => {
  it("rings the absent, toasts the present-elsewhere, suppresses the present, batches, then priority-jumps", () => {
    const h = new DoorbellHarness(); // epoch 09:00, real DEC-060 windows (90s / 5min / 160)
    h.addThread("sat", ["alice", "bob", "carol", "dave"]);
    h.setPresence("alice", "sat", "present_here"); // reading the thread
    h.setPresence("bob", "sat", "present_elsewhere"); // in the app, another thread
    // carol + dave: absent (default)

    // ── Step 1 @ 09:00 — operator posts; nobody absent rings yet (inside the batch window) ──
    h.post("sat", "operator", "Dock at slip B, call 12:30");
    let ds = h.tick();
    expect(find(ds, "sat", "alice")).toMatchObject({ ring: false, reason: "present_suppressed" });
    expect(find(ds, "sat", "bob")).toMatchObject({ channel: "in_app_toast", ring: false, reason: "present_toast" });
    expect(find(ds, "sat", "carol").reason).toBe("within_batch_window");
    expect(find(ds, "sat", "dave").reason).toBe("within_batch_window");
    expect(h.rings).toHaveLength(0);

    // ── Step 2 @ 09:00:30 — a second note batches in; still inside the window ──
    h.advance(parseDuration("30s"));
    h.post("sat", "operator", "Bring extra PFDs");
    ds = h.decide(); // preview — no side effects
    expect(find(ds, "sat", "carol")).toMatchObject({ reason: "within_batch_window", messageCount: 2 });

    // ── Step 3 @ 09:01:30 — the oldest note ages past 90s → ONE batched ring, count 2 (summary) ──
    h.advance(parseDuration("60s"));
    ds = h.tick();
    expect(find(ds, "sat", "carol")).toMatchObject({ ring: true, reason: "batched", mode: "summary", messageCount: 2 });
    expect(find(ds, "sat", "dave")).toMatchObject({ ring: true, reason: "batched", mode: "summary" });
    expect(find(ds, "sat", "alice").ring).toBe(false); // still present → never rung
    expect(find(ds, "sat", "bob").channel).toBe("in_app_toast");
    expect(h.rings).toHaveLength(2); // carol + dave, deduped into one ring each

    // ── Step 4 — carol reads (cancel-on-read); dave's thread is held (first-only-until-read) ──
    h.read("carol", "sat");
    h.advance(parseDuration("10s"));
    ds = h.decide();
    expect(find(ds, "sat", "carol")).toMatchObject({ reason: "all_read", messageCount: 0 });
    expect(find(ds, "sat", "dave").reason).toBe("already_notified");

    // ── Step 5 @ 09:01:40 — a priority jumps the queue, even through a held/quiet thread ──
    h.post("sat", "operator", "Slip changed to C", { priority: true });
    ds = h.tick();
    // carol read everything before → her only unread is the priority → carries content inline
    expect(find(ds, "sat", "carol")).toMatchObject({ ring: true, reason: "priority_bypass", mode: "content", messageCount: 1 });
    // dave never read → priority rings through his backlog of 3 → summary
    expect(find(ds, "sat", "dave")).toMatchObject({ ring: true, reason: "priority_bypass", mode: "summary", messageCount: 3 });
    expect(find(ds, "sat", "alice").ring).toBe(false); // present beats priority — looking means no ring
    expect(find(ds, "sat", "bob").channel).toBe("in_app_toast");
    expect(h.rings).toHaveLength(4);
  });

  it("a sender is never rung for their own message (swarm-fear)", () => {
    const h = new DoorbellHarness();
    h.addThread("crew", ["alice", "bob"]);
    h.post("crew", "alice", "anyone seen the gas key?");
    h.advance(parseDuration("2m"));
    const ds = h.tick();
    expect(find(ds, "crew", "alice").reason).toBe("all_read"); // posted it → no ring
    expect(find(ds, "crew", "bob").ring).toBe(true); // the other member rings
  });
});

describe("command parser (REPL / scenario / test share one surface)", () => {
  it("drives a world through exec() and renders a board", () => {
    const h = new DoorbellHarness();
    h.exec("thread sat alice bob");
    h.exec("present alice sat here");
    h.exec("present bob sat elsewhere");
    h.exec("post sat operator dock at slip B");
    const board = h.exec("decide");
    expect(board).toContain("alice");
    expect(board).toContain("present_suppressed"); // alice, reading the thread
    expect(board).toContain("present_toast"); // bob, in the app elsewhere
  });

  it("strips a trailing -p / --priority flag and flags the message priority", () => {
    const h = new DoorbellHarness();
    h.exec("thread t a");
    h.exec("post t operator urgent now -p"); // a is absent; priority bypasses the batch window
    const d = find(h.decide(), "t", "a");
    expect(d).toMatchObject({ ring: true, reason: "priority_bypass" });
  });

  it("rejects a flag-only post instead of minting an empty-body ring", () => {
    const h = new DoorbellHarness();
    h.exec("thread t a");
    expect(h.exec("post t operator -p")).toMatch(/usage: post/);
    h.advance(parseDuration("2m"));
    expect(h.decide().every((d) => !d.ring)).toBe(true); // nothing was posted → nothing rings
  });

  it("maps present aliases to the three-state verdict", () => {
    const h = new DoorbellHarness();
    h.exec("thread t a b c");
    h.exec("present a t here");
    h.exec("present b t elsewhere");
    h.exec("present c t absent");
    h.exec("post t operator hi");
    h.exec("advance 2m");
    const ds = h.decide();
    expect(find(ds, "t", "a").reason).toBe("present_suppressed");
    expect(find(ds, "t", "b").channel).toBe("in_app_toast");
    expect(find(ds, "t", "c").ring).toBe(true);
  });

  it("tick records rings and reports the count; decide does not", () => {
    const h = new DoorbellHarness();
    h.exec("thread t a");
    h.exec("post t operator hi");
    h.exec("advance 2m");
    h.exec("decide"); // preview — records nothing
    expect(h.rings).toHaveLength(0);
    const out = h.exec("tick");
    expect(out).toContain("1 ring(s) recorded");
    expect(h.rings).toHaveLength(1);
  });

  it("returns usage on malformed commands and an unknown-command hint", () => {
    const h = new DoorbellHarness();
    expect(h.exec("present a")).toMatch(/usage: present/);
    expect(h.exec("post t")).toMatch(/usage: post/);
    expect(h.exec("frobnicate")).toMatch(/unknown command/);
    expect(h.exec("# a comment")).toBe("");
  });
});

describe("parseDuration", () => {
  it("parses h / m / s / ms / bare-ms, NaN on garbage", () => {
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("2m")).toBe(120_000);
    expect(parseDuration("1h")).toBe(3_600_000);
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("250")).toBe(250);
    expect(parseDuration("nope")).toBeNaN();
  });
});
