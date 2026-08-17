import { buildOutboxView, type OutboxCardView } from "@core/admin/outbox-view.js";
import { buildRingOutboxView, type RingOutboxCardView } from "@core/admin/ring-outbox-view.js";
import { buildNoticeOutboxView, type NoticeOutboxCardView } from "@core/admin/notice-outbox-view.js";
import { buildSmsUrl } from "@core/adapters/sms-deep-link.js";
import { TENANT_TIMEZONE } from "@core/config/tenant.js";
import { OutboxCard, type OutboxCardVM } from "../../../../components/outbox/outbox-card";
import { RingOutboxCard, type RingOutboxCardVM } from "../../../../components/outbox/ring-outbox-card";
import { NoticeOutboxCard, type NoticeOutboxCardVM } from "../../../../components/outbox/notice-outbox-card";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { readSubject } from "../../../lib/auth";
import { OPERATOR_CREW_MEMBER_ID } from "../../../lib/operator";
import { getRepo } from "../../../lib/repo";
import { messagingEnabled } from "../../../lib/flags";

/**
 * The operator outbox (DEC-030) — the relay worklist for the web-link pilot
 * channel. Every ask the engine fired and the operator hasn't texted yet,
 * tightest trip first; texted-and-awaiting cards muted below. An ask addressed
 * to the operator themself renders inline Yes/No instead of a Send link
 * (inline-or-relayed, never both). Mobile-first: this page is worked from a
 * phone, where the `sms:` anchor opens the native composer.
 */

export const dynamic = "force-dynamic";

/** Feedback params carry codes/ids, never prose (DEC-026) — map here. */
// Past-tense / action-framed so a lingering redirect param (manual reload, or a
// reseed while sitting on the param'd URL) still reads true — the same stale-safe
// phrasing the At-Risk board uses for its "Last action: …" notices (#93).
const ANSWERED_COPY: Record<string, { tone: "ok" | "bad"; text: string }> = {
  accepted: { tone: "ok", text: "You answered: yes." },
  declined: { tone: "ok", text: "You answered: no." },
  lost: {
    tone: "bad",
    text: "Your yes landed second — the seat was already filled.",
  },
  closed: {
    tone: "ok",
    text: "That ask was already answered — nothing changed.",
  },
};
const OBX_ERROR_COPY: Record<string, string> = {
  gone: "That card just changed — here’s the fresh outbox.",
  not_yours: "That ask isn’t addressed to you — relay it by text instead.",
  unavailable: "Couldn’t reach the schedule — nothing changed. Try again.",
};

type Search = {
  answered?: string;
  obx_error?: string;
  dismissed?: string;
};

export default async function Outbox({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin")
    return <AdminSignedOut subject={subject} />;

  const repo = getRepo();
  let view;
  try {
    view = await buildOutboxView(repo, new Date());
  } catch {
    return (
      <Shell>
        <Notice>Can’t reach the schedule right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const answered = sp.answered ? ANSWERED_COPY[sp.answered] ?? null : null;
  const obxError = sp.obx_error ? OBX_ERROR_COPY[sp.obx_error] ?? null : null;
  const dismissed = sp.dismissed === "ok";
  const pending = view.pending.map(toVM);
  const sent = view.sent.map(toVM);

  // Doorbell-ring relays (DEC-073) — best-effort: a ring-view hiccup must never
  // 500 the ask worklist (the time-critical half).
  // Only when messaging is enabled (#389) — off, there are no rings, and any
  // pre-disable stragglers stay hidden (their thread routes 404 now anyway).
  let ringPending: RingOutboxCardVM[] = [];
  let ringSent: RingOutboxCardVM[] = [];
  if (messagingEnabled()) {
    try {
      const ringView = await buildRingOutboxView(repo);
      ringPending = ringView.pending.map(toRingVM);
      ringSent = ringView.sent.map(toRingVM);
    } catch {
      // leave rings empty
    }
  }

  // Assignment-change relays (DEC-084) — best-effort, same posture as rings.
  let noticePending: NoticeOutboxCardVM[] = [];
  let noticeSent: NoticeOutboxCardVM[] = [];
  try {
    const noticeView = await buildNoticeOutboxView(repo);
    noticePending = noticeView.pending.map(toNoticeVM);
    noticeSent = noticeView.sent.map(toNoticeVM);
  } catch {
    // leave notices empty
  }

  return (
    <Shell>
      <header className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">Outbox</h1>
        </div>
        {pending.length > 0 && (
          <div className="flex shrink-0 items-baseline gap-1.5">
            <span className="text-2xl font-semibold text-ink">
              {pending.length}
            </span>
            <span className="text-xs text-muted">
              ask{pending.length === 1 ? "" : "s"} need{pending.length === 1 ? "s" : ""} you
            </span>
          </div>
        )}
      </header>

      {/* Redirect-param feedback reads safely when stale (DEC-026). The relay
          Send/Resend gives its own optimistic feedback in the card (the island). */}
      {answered && <Notice tone={answered.tone}>{answered.text}</Notice>}
      {dismissed && (
        <Notice tone="ok">
          Dismissed — cleared from your list. The ask still rides to its timeout.
        </Notice>
      )}
      {obxError && <Notice tone="bad">{obxError}</Notice>}

      {pending.length === 0 &&
      sent.length === 0 &&
      ringPending.length === 0 &&
      ringSent.length === 0 &&
      noticePending.length === 0 &&
      noticeSent.length === 0 ? (
        <EmptySuccess />
      ) : (
        <>
          {(pending.length > 0 || sent.length > 0) && (
            <>
              <section className="flex flex-col gap-2">
                {pending.length === 0 ? (
                  <Notice>Nothing left to send — the rest is waiting on replies.</Notice>
                ) : (
                  pending.map((c) => <OutboxCard key={c.entryId} card={c} />)
                )}
              </section>
              {sent.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Sent · awaiting reply
                  </h2>
                  {sent.map((c) => <OutboxCard key={c.entryId} card={c} />)}
                </section>
              )}
            </>
          )}

          {/* Doorbell-ring relays (DEC-073) — a separate section, sorted by recency
              (rings carry no trip to sort by). Clears itself once the crew reads. */}
          {(ringPending.length > 0 || ringSent.length > 0) && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                New messages{ringPending.length > 0 ? ` · ${ringPending.length} to send` : ""}
              </h2>
              {ringPending.map((c) => <RingOutboxCard key={c.entryId} card={c} />)}
              {ringSent.map((c) => <RingOutboxCard key={c.entryId} card={c} />)}
            </section>
          )}

          {/* Assignment-change relays (DEC-084) — "you're on/off a shift" notices,
              recency-sorted. Terminal-on-sent: sent ones stay as the record. */}
          {(noticePending.length > 0 || noticeSent.length > 0) && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Assignment changes{noticePending.length > 0 ? ` · ${noticePending.length} to send` : ""}
              </h2>
              {noticePending.map((c) => <NoticeOutboxCard key={c.entryId} card={c} />)}
              {noticeSent.map((c) => <NoticeOutboxCard key={c.entryId} card={c} />)}
            </section>
          )}
        </>
      )}
    </Shell>
  );
}

/** Format one read-model card into the component's display strings. */
function toVM(c: OutboxCardView): OutboxCardVM {
  const self = c.crewMemberId === OPERATOR_CREW_MEMBER_ID;
  // The text the operator sends = the frozen relay body + the frozen magic link
  // (DEC-030 — never re-minted on render). One value feeds the sms: href, the
  // Web Share sheet (#160), and the copy-pasteable card display.
  const message = `${c.body}\n${c.link}`;
  return {
    entryId: c.entryId,
    askId: c.askId,
    crewName: c.crewName,
    factsLabel: [
      fmtDate(c.date),
      fmtWindow(c.tripStart, c.tripEnd),
      c.vesselName,
      c.roleName,
    ]
      .filter(Boolean)
      .join(" · "),
    toTrip: c.hoursToTrip === null ? null : ttLabel(c.hoursToTrip),
    whyLabel: whyLabel(c),
    smsHref: c.crewPhone
      ? buildSmsUrl({ phone: c.crewPhone, body: message })
      : null,
    shareText: message,
    crewPhone: c.crewPhone,
    mode: c.status === "sent" ? "sent" : self ? "self" : "relay",
    sentLabel: c.sentAt ? `sent ${fmtTime(c.sentAt)}` : null,
  };
}

/** Format one ring read-model into the ring card's display strings (DEC-073). */
function toRingVM(c: RingOutboxCardView): RingOutboxCardVM {
  // The frozen relay body + the frozen deep-link (DEC-030 — never re-minted). One
  // value feeds the sms: href and the Web Share sheet (#160).
  const message = `${c.body}\n${c.link}`;
  return {
    entryId: c.entryId,
    crewName: c.crewName,
    body: c.body,
    shareText: message,
    smsHref: c.crewPhone ? buildSmsUrl({ phone: c.crewPhone, body: message }) : null,
    initialSent: c.status === "sent",
    sentLabel: c.sentAt ? `sent ${fmtTime(c.sentAt)}` : null,
  };
}

/**
 * Format one notice read-model into the notice card's display strings (DEC-084).
 *
 * Byte-identical to `toRingVM` above, and deliberately left that way. The two take different
 * input types and return different output types (ring = DEC-073, notice = DEC-084); the bodies
 * coincide only because the two read models happen to have the same shape *today*. Merging them
 * would couple two independently-evolving surfaces, so that a change to how a notice card renders
 * silently changes ring cards — a worse defect than the repetition, and a harder one to see.
 * Revisit if the two ever become genuinely one concept.
 */
// eslint-disable-next-line sonarjs/no-identical-functions -- same shape, different concepts; see above
function toNoticeVM(c: NoticeOutboxCardView): NoticeOutboxCardVM {
  const message = `${c.body}\n${c.link}`;
  return {
    entryId: c.entryId,
    crewName: c.crewName,
    body: c.body,
    shareText: message,
    smsHref: c.crewPhone ? buildSmsUrl({ phone: c.crewPhone, body: message }) : null,
    initialSent: c.status === "sent",
    sentLabel: c.sentAt ? `sent ${fmtTime(c.sentAt)}` : null,
  };
}

function whyLabel(c: OutboxCardView): string {
  const ord =
    ["1st", "2nd", "3rd"][c.why.ordinal - 1] ?? `${c.why.ordinal}th`;
  const prior = c.why.prior
    ? ` · ${c.why.prior.crewName} ${c.why.prior.outcome === "declined" ? "declined" : "went silent"}`
    : "";
  return `${ord} ask${prior}`;
}

function fmtDate(iso: string): string {
  // Date-only label: UTC both ends so the stored vessel-local date shows
  // verbatim regardless of server zone (DEC-032).
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Trip departure in vessel-local wall-clock (DEC-032), 12-hour. */
function fmtDepart(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TENANT_TIMEZONE,
  });
}

/** The shift's start–end window (DEC-041), vessel-local. Falls back to the bare
 * departure if there's no end, and to null when the shift has no scheduled trip. */
function fmtWindow(startIso: string | null, endIso: string | null): string | null {
  if (!startIso) return null;
  const start = fmtDepart(startIso);
  return endIso ? `${start}–${fmtDepart(endIso)}` : start;
}

function ttLabel(h: number): string {
  if (h < 0) return "departed";
  const whole = Math.round(h);
  if (whole < 24) return `${whole}h to trip`;
  return `${Math.floor(whole / 24)}d ${whole % 24}h to trip`;
}

function EmptySuccess() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-ok-line bg-ok-bg px-6 py-10 text-center">
      <div className="text-2xl text-ok" aria-hidden>
        ✓
      </div>
      <h2 className="text-lg font-semibold text-ink">Nobody’s waiting on you.</h2>
      <p className="max-w-md text-sm text-muted">
        Every fired ask has been relayed and answered. New asks land here the
        moment the engine fires them.
      </p>
    </div>
  );
}
