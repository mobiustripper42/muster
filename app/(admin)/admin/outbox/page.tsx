import { buildOutboxView, type OutboxCardView } from "@core/admin/outbox-view.js";
import { buildSmsUrl } from "@core/adapters/sms-deep-link.js";
import { OutboxCard, type OutboxCardVM } from "../../../../components/outbox/outbox-card";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { readSubject } from "../../../lib/auth";
import { OPERATOR_CREW_MEMBER_ID } from "../../../lib/operator";
import { getRepo } from "../../../lib/repo";

/**
 * The operator outbox (DEC-030) — the relay worklist for the web-link pilot
 * channel. Every ask the engine fired and the operator hasn't texted yet,
 * tightest trip first; texted-and-awaiting cards muted below. An ask addressed
 * to the operator themself renders inline In/Out instead of a Send link
 * (inline-or-relayed, never both). Mobile-first: this page is worked from a
 * phone, where the `sms:` anchor opens the native composer.
 */

export const dynamic = "force-dynamic";

/** Inside this many hours of departure the countdown turns red (UI-only — the
 * board's shouting threshold, not core's membership rule). */
const TIGHT_HOURS = 36;

/** Feedback params carry codes/ids, never prose (DEC-026) — map here. */
const ANSWERED_COPY: Record<string, { tone: "ok" | "bad"; text: string }> = {
  accepted: { tone: "ok", text: "You’re in — the seat is claimed." },
  declined: { tone: "ok", text: "Logged your out." },
  lost: {
    tone: "bad",
    text: "Your yes landed second — the seat was already filled.",
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
};

export default async function Outbox({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <SignedOut />;

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
  const pending = view.pending.map(toVM);
  const sent = view.sent.map(toVM);

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
      {obxError && <Notice tone="bad">{obxError}</Notice>}

      {pending.length === 0 && sent.length === 0 ? (
        <EmptySuccess />
      ) : (
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
    </Shell>
  );
}

/** Format one read-model card into the component's display strings. */
function toVM(c: OutboxCardView): OutboxCardVM {
  const self = c.crewMemberId === OPERATOR_CREW_MEMBER_ID;
  return {
    entryId: c.entryId,
    askId: c.askId,
    crewName: c.crewName,
    factsLabel: `${fmtDate(c.date)} · ${c.vesselName} · ${c.roleName}`,
    toTrip: c.hoursToTrip === null ? null : ttLabel(c.hoursToTrip),
    tight: c.hoursToTrip !== null && c.hoursToTrip < TIGHT_HOURS,
    whyLabel: whyLabel(c),
    // The text the operator sends = the frozen relay body + the frozen magic
    // link (DEC-030 — never re-minted on render).
    smsHref: c.crewPhone
      ? buildSmsUrl({ phone: c.crewPhone, body: `${c.body}\n${c.link}` })
      : null,
    mode: c.status === "sent" ? "sent" : self ? "self" : "relay",
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

function SignedOut() {
  return (
    <Shell>
      <h1 className="text-lg font-semibold text-ink">Muster · Outbox</h1>
      <Notice>
        You’re signed out. Tap an operator magic link to get in — this surface
        is Spink’s.
      </Notice>
    </Shell>
  );
}
