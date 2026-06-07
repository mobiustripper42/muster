import Link from "next/link";
import { buildCrewAppView, type CrewAppView } from "@core/crewapp/crew-view.js";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../lib/auth";
import { getRepo } from "../../lib/repo";
import { respondToAsk } from "./actions";

/**
 * Crew App (SPEC §2.6) — the crew member's whole world: their open ask(s), their
 * confirmed upcoming shifts, their own standing. Insultingly small (BRAND). The
 * shift card with the per-event manifest (§2.6.3) is a separate surface (#13);
 * tapping a shift here will open it.
 *
 * Server component: reads the session, builds the view model through the port,
 * renders. The In/Out buttons post to a server action — no client JS required.
 */
type Search = { auth?: string };

export default async function CrewHome({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();

  if (!subject || subject.kind !== "crew") {
    return <SignedOut reason={sp.auth} />;
  }

  let view: CrewAppView | null;
  try {
    view = await buildCrewAppView(
      getRepo(),
      asId<"CrewMemberId">(subject.id),
      new Date(),
    );
  } catch {
    return <Shell>
      <Notice>Can’t reach the schedule right now. Try again in a moment.</Notice>
    </Shell>;
  }
  if (!view) return <SignedOut reason="stale" />;

  return <CrewApp view={view} />;
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-4 py-6">
      {children}
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-card px-4 py-3 text-sm text-muted">
      {children}
    </div>
  );
}

function SignedOut({ reason }: { reason?: string }) {
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

function CrewApp({ view }: { view: CrewAppView }) {
  return (
    <Shell>
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-ink">{view.me.name}</h1>
        <span className="rounded-full border border-line bg-card px-3 py-1 text-xs font-semibold text-muted">
          {view.standing.line}
        </span>
      </header>

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
          view.shifts.map((s) => (
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
              <span className="text-faint" aria-hidden>
                ›
              </span>
            </Link>
          ))
        )}
      </section>
    </Shell>
  );
}

function AskCard({ ask }: { ask: CrewAppView["asks"][number] }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card shadow-sm">
      <div className="border-b border-line px-4 py-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-accent">
          Muster · now
        </div>
        <div className="mt-1 text-ink">
          {fmtDate(ask.date)} · {ask.vesselName} · {ask.roleName}.{" "}
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
      <div className="px-4 py-2 text-xs text-muted">
        Answer right here — no login, no hunting.
      </div>
    </div>
  );
}
