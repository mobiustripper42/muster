import { cookies } from "next/headers";
import Link from "next/link";
import { buildCrewAppView, type CrewAppView } from "@core/crewapp/crew-view.js";
import { buildThreadList } from "@core/crewapp/thread-list.js";
import { asId } from "@core/domain/ids.js";
import { Notice } from "../../../components/ui/notice";
import { Shell } from "../../../components/ui/shell";
import { VersionTag } from "../../../components/ui/version-tag";
import { readSubject } from "../../lib/auth";
import { selfServeEnabled } from "../../lib/flags";
import { LOGIN_EMAIL_COOKIE } from "../../lib/login-cookie";
import { getRepo } from "../../lib/repo";
import { TENANT_ID } from "../../lib/tenant";
import { fmt12 } from "../../lib/format";
import { requestLoginCode, respondToAsk, signOut, verifyLoginCode } from "./actions";

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
    // code flow (DEC-080) — read it here to render the code-entry screen.
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
  let unreadTotal = 0;
  try {
    const repo = getRepo();
    view = await buildCrewAppView(
      repo,
      asId<"CrewMemberId">(subject.id),
      new Date(),
    );
    // In-app unread badge (§7.6) — best-effort: a messaging hiccup must never
    // break the crew member's home (asks/shifts are the priority surface).
    try {
      unreadTotal = (
        await buildThreadList(repo, asId<"CrewMemberId">(subject.id), TENANT_ID, new Date())
      ).totalUnread;
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
      answeredNote={answeredNote}
      unreadTotal={unreadTotal}
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
    </Shell>
  );
}

const inputClass =
  "min-h-[52px] rounded-card border border-line bg-card px-4 text-ink placeholder:text-faint";
const primaryButtonClass =
  "min-h-[52px] w-full rounded-card bg-accent font-semibold text-white";

/** Step 1: enter your crew email → a code is emailed (DEC-080). */
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
        <button type="submit" className={primaryButtonClass}>
          Email me a code
        </button>
      </form>
    </div>
  );
}

/** Step 2: paste the 6-digit code (DEC-080). The email line is non-committal —
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
        <button type="submit" className={primaryButtonClass}>
          Sign in
        </button>
      </form>
      {/* Re-mint: the email rides as a hidden field (the cookie also holds it). */}
      <form action={requestLoginCode}>
        <input type="hidden" name="email" value={email} />
        <button type="submit" className="text-sm text-muted underline">
          Send a new code
        </button>
      </form>
    </div>
  );
}

/** The §2.6 credential line (#57) — individual, calm, warn tokens only. */
function CredentialLine({ nudge }: { nudge: NonNullable<CrewAppView["credentialNudge"]> }) {
  const date = fmtDate(nudge.expiry);
  const copy =
    nudge.health === "expired"
      ? `Your ${nudge.type} expired ${date} — you won’t be asked for shifts until you renew it.`
      : `Your ${nudge.type} expires ${date} — renew it to keep getting asked for shifts.`;
  return (
    <p className="rounded-card border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn">
      {copy}
    </p>
  );
}

function CrewApp({
  view,
  bailedNote,
  answeredNote,
  unreadTotal,
}: {
  view: CrewAppView;
  bailedNote: string | null;
  answeredNote: string | null;
  unreadTotal: number;
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
          accent pill, never an alarm color (the anxiety-dashboard guard). */}
      <Link
        href="/crew/threads"
        prefetch={false}
        className="flex items-center justify-between rounded-card border border-line bg-card px-4 py-3 shadow-sm"
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
      </Link>

      {bailedNote && <Notice>{bailedNote}</Notice>}
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
          <Notice>No upcoming shifts.</Notice>
        ) : (
          view.shifts.map((s) =>
            // A claimed-but-unconfirmed seat (#4) has no shift card yet (the card
            // is Confirmed-only) — render it as a non-link "awaiting confirmation"
            // row so the "In" visibly landed, without navigating to a dead card.
            s.pending ? (
              <div
                key={s.seatId}
                className="flex items-center justify-between rounded-card border border-line bg-card px-4 py-3 shadow-sm"
              >
                <div className="flex flex-col">
                  <span className="font-semibold text-ink">{fmtDate(s.date)}</span>
                  <span className="text-sm text-muted">
                    {s.vesselName} · {s.roleName}
                  </span>
                </div>
                <span className="rounded-full border border-line bg-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                  Awaiting confirmation
                </span>
              </div>
            ) : (
              <Link
                key={s.seatId}
                href={`/crew/shift/${s.shiftId}`}
                className="flex items-center justify-between rounded-card border border-line bg-card px-4 py-3 shadow-sm"
              >
                <div className="flex flex-col">
                  <span className="font-semibold text-ink">{fmtDate(s.date)}</span>
                  <span className="text-sm text-muted">
                    {s.vesselName} · {s.roleName}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {s.addedByOperator && (
                    <span className="rounded-full border border-line bg-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                      Added for you
                    </span>
                  )}
                  <span className="text-faint" aria-hidden>
                    ›
                  </span>
                </div>
              </Link>
            ),
          )
        )}
      </section>

      {/* Sign-out (DEC-080): quiet, always available — matters on shared/family
          phones with a standing 14-day session. No flag; it only clears the
          caller's own cookie. */}
      <form action={signOut} className="pt-2">
        <button type="submit" className="text-xs text-muted underline">
          Sign out
        </button>
      </form>

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
          {ask.departureTime
            ? ` · ${fmt12(ask.departureTime)}${ask.shiftEndTime ? `–${fmt12(ask.shiftEndTime)}` : ""}`
            : ""}{" "}
          · {ask.vesselName} · {ask.roleName}.{" "}
          <b>In or out?</b>
        </div>
      </div>
      {/* One form, two submit buttons — only the tapped button's response posts.
          No client JS; green In / red Out is the scannable polarity (mockup). */}
      <form action={respondToAsk} className="grid grid-cols-2 gap-px bg-line">
        <input type="hidden" name="askId" value={ask.askId} />
        <button
          type="submit"
          name="response"
          value="declined"
          className="min-h-[52px] w-full bg-card font-semibold text-bad"
        >
          Out
        </button>
        <button
          type="submit"
          name="response"
          value="accepted"
          className="min-h-[52px] w-full bg-ok font-semibold text-white"
        >
          In
        </button>
      </form>
    </div>
  );
}
