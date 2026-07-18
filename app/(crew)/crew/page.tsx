import { cookies } from "next/headers";
import { AppLink } from "../../../components/ui/app-link";
import { buildCrewAppView, type CrewAppView } from "@core/crewapp/crew-view.js";
import { buildThreadList } from "@core/crewapp/thread-list.js";
import { asId } from "@core/domain/ids.js";
import { Notice } from "../../../components/ui/notice";
import { Shell } from "../../../components/ui/shell";
import { VersionTag } from "../../../components/ui/version-tag";
import { readSubject } from "../../lib/auth";
import { selfServeEnabled, messagingEnabled } from "../../lib/flags";
import { LOGIN_EMAIL_COOKIE } from "../../lib/login-cookie";
import {
  SMS_CONSENT_FIELD,
  SMS_CONSENT_FIELD_VALUE,
  SMS_CONSENT_POLICY_URL,
} from "../../lib/sms-consent";
import { getRepo } from "../../lib/repo";
import { TENANT_ID } from "../../lib/tenant";
import { fmt12 } from "../../lib/format";
import { vesselHueClass } from "../../lib/vessel-hue";
import { requestLoginCode, respondToAsk, signOut, verifyLoginCode } from "./actions";
import { switchToAdmin } from "../../lib/switch-actions";
import { SubmitButton } from "../../../components/ui/submit-button";

/** #161: the In/Out tap's outcome → a calm /crew notice (codes only, DEC-026). */
const ANSWERED_NOTE: Record<string, string> = {
  in: "You’re in — it’s in My shifts below.",
  out: "Marked out — thanks for the quick reply.",
  filled: "That seat was already filled — nothing more needed from you.",
  booked: "You’re already on another seat that day — can’t take two.",
  already: "You already answered this one — you’re all set.",
  error: "Couldn’t record that just now — try the tap again.",
};

/**
 * Crew App (SPEC §2.6) — the crew member's whole world: their open ask(s), their
 * confirmed upcoming shifts, their own standing. Insultingly small (BRAND). The
 * shift card with the per-event manifest (§2.6.3) is a separate surface (#13);
 * tapping a shift here will open it.
 *
 * Server component: reads the session, builds the view model through the port,
 * renders. The In/Out buttons post to a server action — no client JS required.
 */
type Search = {
  auth?: string;
  bailed?: string;
  claimed?: string;
  answered?: string;
  stage?: string;
  err?: string;
};

export default async function CrewHome({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();

  if (!subject || subject.kind !== "crew") {
    // The entered email is carried in an httpOnly cookie across the two-step
    // code flow (DEC-081) — read it here to render the code-entry screen.
    const pendingEmail = (await cookies()).get(LOGIN_EMAIL_COOKIE)?.value ?? null;
    return (
      <SignedOut
        reason={sp.auth}
        flag={selfServeEnabled()}
        stage={sp.stage}
        err={sp.err}
        pendingEmail={pendingEmail}
      />
    );
  }

  let view: CrewAppView | null;
  let bailedNote: string | null = null;
  let claimedNote: string | null = null;
  // Dual-role (DEC-093): a crew member who is ALSO an active admin gets a
  // "Switch to admin" control by sign-out. `getAdmin` is null for the (near-all)
  // crew-only majority — one cheap lookup on an already-DB-heavy home render.
  // Best-effort: a hiccup here just hides the switch, never breaks the crew home
  // (asks/shifts are the priority surface). The escalation is gated server-side
  // regardless — this only decides whether the button shows.
  const viewerIsActiveAdmin = await getRepo()
    .getAdmin(subject.id)
    .then((a) => !!a?.active)
    .catch(() => false);

  let unreadTotal = 0;
  try {
    const repo = getRepo();
    view = await buildCrewAppView(
      repo,
      asId<"CrewMemberId">(subject.id),
      new Date(),
    );
    // In-app unread badge (§7.6) — best-effort: a messaging hiccup must never
    // break the crew member's home (asks/shifts are the priority surface). Skipped
    // entirely when messaging is disabled (#389) — the badge is hidden anyway, so
    // the thread-list query is pure waste.
    try {
      unreadTotal = messagingEnabled()
        ? (
            await buildThreadList(repo, asId<"CrewMemberId">(subject.id), TENANT_ID, new Date())
          ).totalUnread
        : 0;
    } catch {
      unreadTotal = 0;
    }
    // `bailed` carries a shift id (codes/ids only, DEC-026); resolve it to a
    // date we know — a crafted URL with an unknown id renders nothing, and one
    // naming a shift they're demonstrably still on is suppressed too. No
    // re-asking claim: whether the seat refills (re-ask vs rested) is the
    // operator's concern, not this surface's.
    if (sp.bailed && view && !view.shifts.some((s) => s.shiftId === sp.bailed)) {
      const shift = await repo.getShift(asId<"ShiftId">(sp.bailed));
      if (shift) {
        bailedNote = `You’re off the ${fmtDate(shift.date)} shift — nothing else needed from you.`;
      }
    }
    // `claimed` carries a shift id (DEC-026) — resolve to a date for the calm
    // self-serve confirmation. A real claim is Confirmed, so it's in the viewer's
    // own shifts; gate on that (10.3 audit) so a crafted `?claimed=<foreign-shift>`
    // can't spoof a "you're on" note or oracle a shift's existence/date.
    if (sp.claimed && view?.shifts.some((s) => s.shiftId === sp.claimed)) {
      const shift = await repo.getShift(asId<"ShiftId">(sp.claimed));
      if (shift) {
        claimedNote = `You’re on the ${fmtDate(shift.date)} shift — it’s in My shifts below.`;
      }
    }
  } catch {
    return <Shell>
      <Notice>Can’t reach the schedule right now. Try again in a moment.</Notice>
    </Shell>;
  }
  if (!view)
    return (
      <SignedOut
        reason="stale"
        flag={selfServeEnabled()}
        pendingEmail={null}
      />
    );

  const answeredNote = sp.answered ? ANSWERED_NOTE[sp.answered] ?? null : null;
  return (
    <CrewApp
      view={view}
      bailedNote={bailedNote}
      claimedNote={claimedNote}
      answeredNote={answeredNote}
      unreadTotal={unreadTotal}
      selfServe={selfServeEnabled()}
      viewerIsActiveAdmin={viewerIsActiveAdmin}
    />
  );
}

function fmtDate(iso: string): string {
  // Date-only label: parse + format both in UTC so the stored vessel-local
  // calendar date shows verbatim regardless of server zone (DEC-032).
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The shift's working window "11:00 AM–5:45 PM" (or just the departure) for a
 *  My-shifts card (#216) — Mono, so crew see WHEN at a glance. Null = no time. */
function timeWindow(s: { callTime?: string; shiftEndTime?: string }): string | null {
  if (!s.callTime) return null;
  return s.shiftEndTime
    ? `${fmt12(s.callTime)}–${fmt12(s.shiftEndTime)}`
    : fmt12(s.callTime);
}

/** "with Jamie" / "with Jamie & Sam" / "with Jamie +2" (#216). Null when solo. */
function withCrew(coCrew: { name: string }[]): string | null {
  if (coCrew.length === 0) return null;
  if (coCrew.length === 1) return `with ${coCrew[0]!.name}`;
  if (coCrew.length === 2) return `with ${coCrew[0]!.name} & ${coCrew[1]!.name}`;
  return `with ${coCrew[0]!.name} +${coCrew.length - 1}`;
}

/** A My-shifts card's when + what/who (#216): date + time window (the hero, Mono),
 *  then one quiet vessel · role · co-crew line. Shared by confirmed + pending. */
function ShiftWhenWhat({ s }: { s: CrewAppView["shifts"][number] }) {
  const window = timeWindow(s);
  const crew = withCrew(s.coCrew);
  return (
    <div className="flex min-w-0 flex-col">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold text-ink">{fmtDate(s.date)}</span>
        {window && <span className="font-mono text-sm text-ink">{window}</span>}
      </span>
      <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
        {/* DEC-086 vessel identity dot — which boat, at a glance across a
            mixed-vessel list. aria-hidden; the vessel name is the accessible answer. */}
        <span
          className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${vesselHueClass(s.vesselId)}`}
          aria-hidden
        />
        <span>
          {s.vesselName} · {s.roleName}
          {crew ? ` · ${crew}` : ""}
        </span>
      </span>
    </div>
  );
}

function SignedOut({
  reason,
  flag,
  stage,
  err,
  pendingEmail,
}: {
  reason?: string;
  flag: boolean;
  stage?: string;
  err?: string;
  pendingEmail: string | null;
}) {
  // Flag OFF (prod until 7.0b wires real email, DEC-059/080): today's behavior —
  // the only way in is the operator-relayed link.
  if (!flag) {
    const message =
      reason && reason !== "stale"
        ? "That link didn’t work — it may have expired or already been used. Ask your operator for a fresh one."
        : "You’re signed out. Tap the link your operator sent to get back in.";
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-ink">Muster</h1>
        <Notice>{message}</Notice>
        <VersionTag />
      </Shell>
    );
  }

  const onCodeStep = stage === "code" && !!pendingEmail;
  return (
    <Shell>
      <h1 className="text-lg font-semibold text-ink">Muster</h1>
      {onCodeStep ? (
        <CodeStep email={pendingEmail!} err={err} />
      ) : (
        <EmailStep err={err} />
      )}
      <VersionTag />
    </Shell>
  );
}

const inputClass =
  "min-h-[52px] rounded-card border border-line bg-card px-4 text-ink placeholder:text-faint";
const primaryButtonClass =
  "min-h-[52px] w-full rounded-card bg-accent font-semibold text-white";

/**
 * SMS opt-in consent block (Twilio 10DLC vetting). A public, visible,
 * UNCHECKED-by-default checkbox with the full disclosure + working policy links.
 * It NEVER gates login — checking is voluntary; opt-in as a condition of access
 * is an automatic 10DLC rejection, and this is kept separate from any ToS accept.
 * The copy is the verbatim `SMS_CONSENT_TEXT` (`app/lib/sms-consent`) rendered
 * with the two policy phrases linked — keep them in sync (that constant is the
 * exact string stored with each opt-in).
 */
function SmsConsentBlock() {
  return (
    <div className="flex items-start gap-2 rounded-card border border-line bg-card px-3 py-2">
      <input
        id={SMS_CONSENT_FIELD}
        name={SMS_CONSENT_FIELD}
        type="checkbox"
        value={SMS_CONSENT_FIELD_VALUE}
        className="mt-0.5 h-4 w-4 shrink-0"
      />
      <label htmlFor={SMS_CONSENT_FIELD} className="text-xs leading-snug text-muted">
        I agree to receive SMS text messages from Cleveland Cycleboats, LLC
        (BrewBoat) at the mobile number on my crew record about shift availability
        and scheduling. Message frequency varies. Message and data rates may apply.
        Reply STOP to opt out, HELP for help. See our{" "}
        <a
          href={SMS_CONSENT_POLICY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline"
        >
          Privacy Policy
        </a>{" "}
        and{" "}
        <a
          href={SMS_CONSENT_POLICY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline"
        >
          Terms
        </a>
        .
      </label>
    </div>
  );
}

/** Step 1: enter your crew email → a code is emailed (DEC-081). */
function EmailStep({ err }: { err?: string }) {
  return (
    <div className="flex flex-col gap-3">
      {err === "locked" && (
        <Notice>Too many tries on that code. Request a fresh one below.</Notice>
      )}
      {err === "expired" && (
        <Notice>That code expired. Request a fresh one below.</Notice>
      )}
      <form action={requestLoginCode} className="flex flex-col gap-3">
        <label htmlFor="email" className="text-sm text-muted">
          Sign in with your crew email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className={inputClass}
        />
        <SmsConsentBlock />
        <SubmitButton className={primaryButtonClass}>
          Email me a code
        </SubmitButton>
      </form>
    </div>
  );
}

/** Step 2: paste the 6-digit code (DEC-081). The email line is non-committal —
 *  it never confirms roster membership (no-enumeration). */
function CodeStep({ email, err }: { email: string; err?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <Notice>
        If {email} is on the crew, a 6-digit code is on its way. Enter it below.
      </Notice>
      {err === "invalid" && (
        <Notice>That code didn’t match — check it and try again.</Notice>
      )}
      <form action={verifyLoginCode} className="flex flex-col gap-3">
        <label htmlFor="code" className="text-sm text-muted">
          Enter your code
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          placeholder="123456"
          className={`${inputClass} tracking-[0.5em]`}
        />
        <SubmitButton className={primaryButtonClass}>
          Sign in
        </SubmitButton>
      </form>
      {/* Re-mint: the email rides as a hidden field (the cookie also holds it). */}
      <form action={requestLoginCode}>
        <input type="hidden" name="email" value={email} />
        <SubmitButton className="text-sm text-muted underline">
          Send a new code
        </SubmitButton>
      </form>
    </div>
  );
}

/** The §2.6 credential line (#57) — individual, calm, warn tokens only. */
function CredentialLine({ nudge }: { nudge: NonNullable<CrewAppView["credentialNudge"]> }) {
  const date = fmtDate(nudge.expiry);
  const copy =
    nudge.health === "expired"
      ? `Your ${nudge.type} expired ${date} — you won’t be asked for shifts until it’s renewed. Renew it and the office will update your record.`
      : `Your ${nudge.type} expires ${date} — renew it to keep getting asked for shifts. The office updates your record once you have.`;
  return (
    <p className="rounded-card border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn">
      {copy}
    </p>
  );
}

function CrewApp({
  view,
  bailedNote,
  claimedNote,
  answeredNote,
  unreadTotal,
  selfServe,
  viewerIsActiveAdmin,
}: {
  view: CrewAppView;
  bailedNote: string | null;
  claimedNote: string | null;
  answeredNote: string | null;
  unreadTotal: number;
  selfServe: boolean;
  viewerIsActiveAdmin: boolean;
}) {
  return (
    <Shell>
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-ink">{view.me.name}</h1>
        {/* Own standing (§2.6.2): individual, plain, never comparative. Stays
            visually quiet — do NOT color the negative facts; that would turn a
            neutral fact into the anxiety dashboard BRAND forbids. */}
        <p
          className="text-xs leading-snug text-muted"
          aria-label={`Your standing: ${view.standing.line}`}
        >
          {view.standing.line}
        </p>
      </header>

      {/* Messages (§7.6 in-app): a calm entry point with the unread count — an
          accent pill, never an alarm color (the anxiety-dashboard guard). Hidden
          when messaging is disabled (#389). */}
      {messagingEnabled() && (
        <AppLink
          href="/crew/threads"
          prefetch={false}
          spinner="overlay"
          className="relative flex items-center justify-between rounded-card border border-line bg-card px-4 py-3 shadow-sm"
        >
          <span className="font-semibold text-ink">Messages</span>
          {unreadTotal > 0 ? (
            <span
              className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white"
              aria-label={`${unreadTotal} unread`}
            >
              {unreadTotal}
            </span>
          ) : (
            <span className="text-faint" aria-hidden>
              ›
            </span>
          )}
        </AppLink>
      )}

      {/* Time off (#332, DEC-009): a quiet self-serve entry — set the dates you're
          off. Neutral, never accent — it's a utility, not a summons, and
          deliberately NOT an availability screen (DEC-009 line). */}
      <AppLink
        href="/crew/time-off"
        prefetch={false}
        spinner="overlay"
        className="flex items-center justify-between rounded-card border border-line bg-card px-4 py-3 shadow-sm"
      >
        <span className="font-semibold text-ink">Time off</span>
        <span className="text-faint" aria-hidden>
          ›
        </span>
      </AppLink>

      {/* Calendar sync (#355, DEC-098) — a subscribable iCal feed of your confirmed
          shifts. Push, not pull: the shift lands in your own calendar. */}
      <AppLink
        href="/crew/calendar"
        prefetch={false}
        spinner="overlay"
        className="flex items-center justify-between rounded-card border border-line bg-card px-4 py-3 shadow-sm"
      >
        <span className="font-semibold text-ink">Calendar sync</span>
        <span className="text-faint" aria-hidden>
          ›
        </span>
      </AppLink>

      {/* The 4th surface (DEC-074): a calm pull entry point, flag-gated. Neutral
          accent, never an alarm — it's an invitation, not a demand. */}
      {selfServe && (
        <AppLink
          href="/crew/open"
          prefetch={false}
          spinner="overlay"
          className="relative flex items-center justify-between rounded-card border border-accent bg-accent px-4 py-3 font-semibold text-white shadow-sm"
        >
          <span>Pick up a shift</span>
          <span aria-hidden>›</span>
        </AppLink>
      )}

      {bailedNote && <Notice>{bailedNote}</Notice>}
      {claimedNote && <Notice>{claimedNote}</Notice>}
      {answeredNote && <Notice>{answeredNote}</Notice>}
      {view.credentialNudge && <CredentialLine nudge={view.credentialNudge} />}

      {view.asks.length > 0 && (
        <section className="flex flex-col gap-2">
          {view.asks.map((ask) => (
            <AskCard key={ask.askId} ask={ask} />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          My shifts
        </h2>
        {view.shifts.length === 0 ? (
          <Notice>
            Nothing booked right now — that’s normal. You’ll get a ping when
            there’s a trip for you.
          </Notice>
        ) : (
          view.shifts.map((s) =>
            // A claimed-but-unconfirmed seat (#4) has no shift card yet (the card
            // is Confirmed-only) — render it as a non-link "awaiting confirmation"
            // row so the "In" visibly landed, without navigating to a dead card.
            s.pending ? (
              <div
                key={s.seatId}
                className="flex flex-col gap-1 rounded-card border border-line bg-card px-4 py-3 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <ShiftWhenWhat s={s} />
                  <span className="shrink-0 rounded-full border border-line bg-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                    Awaiting confirmation
                  </span>
                </div>
              </div>
            ) : (
              <AppLink
                key={s.seatId}
                href={`/crew/shift/${s.shiftId}`}
                spinner="overlay"
                className="relative flex flex-col gap-1 rounded-card border border-line bg-card px-4 py-3 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <ShiftWhenWhat s={s} />
                  <span className="shrink-0 text-faint" aria-hidden>
                    ›
                  </span>
                </div>
                {s.addedByOperator && (
                  <span className="self-start rounded-full border border-line bg-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                    Added for you
                  </span>
                )}
              </AppLink>
            ),
          )
        )}
      </section>

      {/* Sign-out (DEC-081): quiet, always available — matters on shared/family
          phones with a standing 14-day session. No flag; it only clears the
          caller's own cookie. Beside it, for a dual-role person, the switch UP
          to the admin cockpit (DEC-093 — gated server-side on active-admin). */}
      <div className="flex items-center gap-4 pt-2">
        <AppLink
          href="/crew/help"
          prefetch={false}
          className="text-xs text-muted underline"
        >
          How Muster works
        </AppLink>
        {viewerIsActiveAdmin && (
          <form action={switchToAdmin}>
            <SubmitButton className="text-xs text-accent underline">
              Switch to admin
            </SubmitButton>
          </form>
        )}
        <form action={signOut}>
          <SubmitButton className="text-xs text-muted underline">
            Sign out
          </SubmitButton>
        </form>
      </div>

      <VersionTag />
    </Shell>
  );
}

function AskCard({ ask }: { ask: CrewAppView["asks"][number] }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card shadow-sm">
      <div className="border-b border-line px-4 py-3">
        <div className="text-ink">
          {fmtDate(ask.date)}
          {ask.callTime
            ? ` · ${fmt12(ask.callTime)}${ask.shiftEndTime ? `–${fmt12(ask.shiftEndTime)}` : ""}`
            : ""}{" "}
          · {ask.vesselName} · {ask.roleName}.{" "}
          <b>In or out?</b>
        </div>
        {/* First-timer orientation (10.6): name what the tap commits — this one
            shift (NOT "the whole day" — that's the open-shift claim). Nudge
            toward answering either way (silence is what hurts the score). Muted,
            non-alarming (the anxiety-dashboard guard). */}
        <div className="mt-1 text-xs text-muted">
          In = you’re on for this shift. Out = you’re not — either way, please tap.
        </div>
      </div>
      {/* One form, two submit buttons — only the tapped button's response posts;
          each spins alone via its own name/value (DEC-089). No-JS still submits;
          green In / red Out is the scannable polarity (mockup). */}
      <form action={respondToAsk} className="grid grid-cols-2 gap-px bg-line">
        <input type="hidden" name="askId" value={ask.askId} />
        <SubmitButton
          name="response"
          value="declined"
          className="min-h-[52px] w-full bg-card font-semibold text-bad"
        >
          Out
        </SubmitButton>
        <SubmitButton
          name="response"
          value="accepted"
          className="min-h-[52px] w-full bg-ok font-semibold text-white"
        >
          In
        </SubmitButton>
      </form>
    </div>
  );
}
