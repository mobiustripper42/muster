/**
 * Human-drivable Smart Doorbell harness (#115, Phase 6.5) — the decider's
 * observable-behavior spec, not a test page.
 *
 * Wraps the pure decider (#114) in a faithful mini **edge + tick** plus a fake
 * "would-ring" sink, so a person can SEE the invisible timing/attention logic:
 * define crew, set who's present in which thread, post messages, advance the
 * batch clock, trigger reads — and watch who rings vs stays silent, what batches
 * into one ring, what jumps the queue on priority, what arrives as in-app toast
 * vs SMS. The CLI glue is `db/doorbell-dev.ts`.
 *
 * Not app code — dev/test infra, the doorbell analog of FakeChannel (DEC-MSG-3).
 * It **sends nothing**: `tick()` records the decider's ring decisions into a
 * would-ring log (the read-only window #115 asks for). The real notification
 * channel + read/priority persistence are 6.6; this harness injects them.
 *
 * **Presence** is the decider's DEC-068 three-state verdict, set DIRECTLY per
 * `(crew, thread)`: `here | elsewhere | absent`. v1's real edge only ever produces
 * `elsewhere | absent` from the coarse signal — `here` (full §7.1 suppression)
 * simulates the future per-thread realtime edge so the whole decider is drivable.
 *
 * **Two verbs mirror the runtime split (DEC-049):** `decide()` is a
 * side-effect-free preview ("what would happen now"); `tick()` fires — it records
 * notify-state for every ring, so first-only-until-read and re-arm-after-read are
 * demonstrable across `advance`. The clock is logical: `advance(ms)` moves an
 * injected `now`; nothing here reads the wall clock.
 *
 * **Two deliberate simplifications vs real v1** — the board can otherwise mislead:
 *   - **Presence is a *sticky manual verdict* — it does NOT decay.** The real edge
 *     expires `present_*` to `absent` after `presenceWindowMs` (DEC-060) and then
 *     SMS-rings; here a `present` setting holds across every `advance` until you
 *     change it. So a standing toast/suppress here is permanent; in prod it lapses.
 *   - **The clock has no sub-tick resolution.** A `read` and a later `post` at the
 *     *same* logical instant tie toward "read" (the decider's `isReadBy` uses `<=`),
 *     so that message is treated as already-read. `advance` between a read and a
 *     subsequent post to see the new message ring.
 */

import { asId } from "../domain/ids.js";
import type { CrewMemberId, ThreadId } from "../domain/ids.js";
import type { Subject } from "../domain/entities.js";
import {
  DOORBELL_BATCH_WINDOW_MS,
  DOORBELL_PRESENCE_WINDOW_MS,
  DOORBELL_SHORT_NOTICE_MAX_CHARS,
} from "../config/tenant.js";
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

/** A logical anchor so the CLI and tests start deterministic — a Saturday 9am UTC. */
export const HARNESS_EPOCH = "2026-07-04T09:00:00.000Z";

/** Sender names the harness treats as the operator/office (`senderKind:"admin"`). */
const OPERATOR_NAMES = new Set(["operator", "office", "admin"]);

/** A recorded ring — the decider decision plus the clock it fired at. No real send. */
export interface WouldRing {
  at: string;
  decision: NotificationDecision;
}

export interface HarnessOptions {
  now?: string;
  rules?: DoorbellRules;
}

export class DoorbellHarness {
  #now: string;
  readonly #rules: DoorbellRules;
  /** Declared roster — satisfies "define crew" (#115 AC) + the `crew:` echo; the
   *  decider derives recipients from thread membership, not this set. */
  readonly #crew = new Set<string>();
  readonly #threads = new Map<ThreadId, CrewMemberId[]>();
  readonly #messages: PendingMessage[] = [];
  readonly #presence = new Map<string, PresenceState>();
  readonly #read = new Map<string, string>();
  readonly #notify = new Map<string, string>();
  readonly #rings: WouldRing[] = [];
  #seq = 0;

  constructor(opts: HarnessOptions = {}) {
    this.#now = opts.now ?? HARNESS_EPOCH;
    this.#rules =
      opts.rules ??
      makeDoorbellRules({
        batchWindowMs: DOORBELL_BATCH_WINDOW_MS,
        presenceWindowMs: DOORBELL_PRESENCE_WINDOW_MS,
        shortNoticeMaxChars: DOORBELL_SHORT_NOTICE_MAX_CHARS,
      });
  }

  // ── world building ──

  addCrew(...ids: string[]): void {
    for (const id of ids) this.#crew.add(id);
  }

  /** Register a thread and its members (crew ids). Members can be set once here. */
  addThread(id: string, members: string[]): void {
    const tid = asId<"ThreadId">(id);
    const memberIds = members.map((m) => asId<"CrewMemberId">(m));
    for (const m of members) this.#crew.add(m);
    this.#threads.set(tid, memberIds);
  }

  /** Set the DEC-068 presence verdict for a crew member in a thread. */
  setPresence(crew: string, thread: string, state: PresenceState): void {
    this.#presence.set(memberThreadKey(asId<"ThreadId">(thread), crewSubject(crew)), state);
  }

  /** Post a message to a thread at the current clock. `operator`/`office`/`admin` post as the office. */
  post(thread: string, sender: string, body: string, opts: { priority?: boolean } = {}): void {
    const isOperator = OPERATOR_NAMES.has(sender);
    this.#messages.push({
      id: asId<"MessageId">(`msg-${++this.#seq}`),
      threadId: asId<"ThreadId">(thread),
      senderId: sender,
      senderKind: isOperator ? "admin" : "crew",
      body,
      createdAt: this.#now,
      priority: opts.priority ?? false,
    });
  }

  /** Mark a crew member as having read a thread now (clears its unread → cancel-on-read). */
  read(crew: string, thread: string): void {
    this.#read.set(memberThreadKey(asId<"ThreadId">(thread), crewSubject(crew)), this.#now);
  }

  /** Advance the logical clock by `ms`. */
  advance(ms: number): void {
    this.#now = new Date(Date.parse(this.#now) + ms).toISOString();
  }

  get now(): string {
    return this.#now;
  }

  /** The would-ring log in fire order — a fresh array (entries are shared refs; dev infra). */
  get rings(): readonly WouldRing[] {
    return [...this.#rings];
  }

  // ── observation ──

  /** Preview: what the doorbell would decide right now. No side effects (DEC-049). */
  decide(): NotificationDecision[] {
    return decideNotifications(this.#input());
  }

  /**
   * Fire the doorbell: decide, then record notify-state for every ring (what 6.6's
   * tick will persist) so first-only-until-read + re-arm hold across `advance`.
   * Returns the same decisions `decide()` would.
   */
  tick(): NotificationDecision[] {
    const decisions = this.decide();
    for (const d of decisions) {
      if (!d.ring) continue;
      this.#notify.set(memberThreadKey(d.threadId, d.subject), this.#now);
      this.#rings.push({ at: this.#now, decision: d });
    }
    return decisions;
  }

  #input(): DoorbellInput {
    return {
      pendingMessages: this.#messages,
      threadMembers: this.#threads,
      presence: this.#presence,
      readState: this.#read,
      notifyState: this.#notify,
      rules: this.#rules,
      now: this.#now,
    };
  }

  // ── rendering ──

  /** A human-readable doorbell board for a decision set (defaults to a fresh preview). */
  render(decisions: NotificationDecision[] = this.decide()): string {
    const lines: string[] = [`doorbell @ ${this.#now}`];
    for (const [tid, members] of this.#threads) {
      lines.push(`  [${tid}]`);
      const byThread = decisions.filter((d) => d.threadId === tid);
      for (const memberId of members) {
        const d = byThread.find((x) => x.subject.id === String(memberId));
        lines.push(`    ${pad(String(memberId), 10)} ${d ? outcomeLine(d) : "(no decision)"}`);
      }
    }
    return lines.join("\n");
  }

  // ── command parsing (one entry point for the REPL, scenarios, and tests) ──

  /**
   * Run one harness command line and return its printable output. The REPL, the
   * scripted scenarios, and the tests all drive through this, so "what a human
   * types" and "what the spec asserts" are the same surface.
   *
   *   crew <id...>                      add crew
   *   thread <id> <member...>           create a thread with members
   *   present <crew> <thread> <here|elsewhere|absent>
   *   post <thread> <sender> <body...> [-p|--priority]
   *   read <crew> <thread>
   *   advance <dur>                     e.g. 90s, 2m, 1h
   *   decide | board                    preview the doorbell (no side effects)
   *   tick                              fire it (records rings)
   *   rings | now | help
   */
  exec(line: string): string {
    const raw = line.trim();
    if (raw === "" || raw.startsWith("#")) return "";
    const tokens = raw.split(/\s+/);
    const [cmd, ...rest] = tokens;
    switch (cmd) {
      case "crew":
        this.addCrew(...rest);
        return `crew: ${[...this.#crew].join(", ") || "(none)"}`;
      case "thread": {
        const [id, ...members] = rest;
        if (!id) return "usage: thread <id> <member...>";
        this.addThread(id, members);
        return `thread ${id}: ${members.join(", ") || "(no members)"}`;
      }
      case "present": {
        const [crew, thread, state] = rest;
        const verdict = state === undefined ? undefined : PRESENCE_ALIAS[state];
        if (!crew || !thread || verdict === undefined) {
          return "usage: present <crew> <thread> <here|elsewhere|absent>";
        }
        this.setPresence(crew, thread, verdict);
        return `present ${crew}@${thread} = ${verdict}`;
      }
      case "post": {
        const [thread, sender, ...bodyTokens] = rest;
        const priority = popPriorityFlag(bodyTokens); // strip the flag FIRST, then guard the body
        if (!thread || !sender || bodyTokens.length === 0) {
          return "usage: post <thread> <sender> <body...> [-p]";
        }
        this.post(thread, sender, bodyTokens.join(" "), { priority });
        return `posted to ${thread} by ${sender}${priority ? " [priority]" : ""} @ ${this.#now}`;
      }
      case "read": {
        const [crew, thread] = rest;
        if (!crew || !thread) return "usage: read <crew> <thread>";
        this.read(crew, thread);
        return `${crew} read ${thread} @ ${this.#now}`;
      }
      case "advance": {
        const [dur] = rest;
        const ms = dur ? parseDuration(dur) : NaN;
        if (Number.isNaN(ms)) return "usage: advance <dur>  (e.g. 90s, 2m, 1h)";
        this.advance(ms);
        return `advanced to ${this.#now}`;
      }
      case "decide":
      case "board":
        return this.render(this.decide());
      case "tick": {
        const before = this.#rings.length;
        const out = this.render(this.tick());
        const fired = this.#rings.length - before;
        return `${out}\n  → ${fired} ring(s) recorded`;
      }
      case "rings":
        return this.#rings.length === 0
          ? "(no rings yet)"
          : this.#rings.map((r) => `${r.at}  ${outcomeLine(r.decision)}  ${r.decision.subject.id}`).join("\n");
      case "now":
        return this.#now;
      case "help":
        return HELP;
      default:
        return `unknown command: ${cmd} (try 'help')`;
    }
  }
}

// ── shared helpers ──

function crewSubject(id: string): Subject {
  return { kind: "crew", id };
}

/** Parse a duration spec (`90s`, `2m`, `1h`, `500ms`, or bare ms) → milliseconds. */
export function parseDuration(spec: string): number {
  const m = /^(\d+)(ms|s|m|h)?$/.exec(spec.trim());
  if (!m) return NaN;
  const n = Number(m[1]);
  switch (m[2]) {
    case "h":
      return n * 3_600_000;
    case "m":
      return n * 60_000;
    case "s":
      return n * 1_000;
    default:
      return n; // "ms" or bare → milliseconds
  }
}

const PRESENCE_ALIAS: Record<string, PresenceState> = {
  here: "present_here",
  elsewhere: "present_elsewhere",
  absent: "absent",
  present_here: "present_here",
  present_elsewhere: "present_elsewhere",
};

/** Strip a trailing `-p`/`--priority` flag from the body tokens, mutating in place. */
function popPriorityFlag(bodyTokens: string[]): boolean {
  const last = bodyTokens[bodyTokens.length - 1];
  if (last === "-p" || last === "--priority") {
    bodyTokens.pop();
    return true;
  }
  return false;
}

function outcomeLine(d: NotificationDecision): string {
  const count = `(${d.messageCount} unread)`;
  if (d.ring) return `${pad("RING", 6)} ${pad(`${d.reason}/${d.mode}`, 26)} ${count}  → would-SMS`;
  if (d.channel === "in_app_toast") return `${pad("TOAST", 6)} ${pad(d.reason, 26)} ${count}`;
  if (d.reason === "all_read") return `${pad("noop", 6)} ${pad(d.reason, 26)} ${count}`;
  return `${pad("quiet", 6)} ${pad(d.reason, 26)} ${count}`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

const HELP = [
  "commands:",
  "  crew <id...>                              add crew",
  "  thread <id> <member...>                   create a thread with members",
  "  present <crew> <thread> here|elsewhere|absent",
  "  post <thread> <sender> <body...> [-p]     sender 'operator' posts as the office; -p = priority",
  "  read <crew> <thread>                      mark a thread read (cancel-on-read)",
  "  advance <dur>                             move the clock (90s, 2m, 1h)",
  "  decide | board                            preview the doorbell (no side effects)",
  "  tick                                      fire it — records rings",
  "  rings | now | help | quit",
  "",
  "notes: presence is a sticky verdict — it does NOT decay across 'advance' (real v1",
  "       lapses it to absent after the presence window). A 'read' then a same-tick",
  "       'post' ties toward read — 'advance' between them to see the new message ring.",
].join("\n");
