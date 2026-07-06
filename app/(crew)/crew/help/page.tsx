import type { Metadata } from "next";
import { BackLink } from "../../../../components/ui/back-link";
import { Shell } from "../../../../components/ui/shell";

/**
 * Crew quick-start (Phase 10.6/10.7) — the "what is Muster / how to answer an
 * ask" orientation a newcomer never gets from the terse UI. Public (no auth):
 * a crew member can read it from the sign-in screen before they're in, and it's
 * the in-app twin of docs/CREW_QUICKSTART.md (same content, one voice).
 *
 * Server-rendered, no client JS (crew-surface default). Calm, plain, short.
 */
export const metadata: Metadata = { title: "How Muster works" };

/** One labelled block — keeps the page a scannable stack, not a wall of prose. */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1 rounded-card border border-line bg-card px-4 py-3 shadow-sm">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <div className="text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function CrewHelpPage() {
  return (
    <Shell>
      <BackLink href="/crew">Shifts</BackLink>
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-ink">How Muster works</h1>
        <p className="text-sm text-muted">
          The short version — you can get back to this anytime from the link on
          your home screen.
        </p>
      </header>

      <Block title="What it is">
        Muster is how your operator asks who’s working which trips. When there’s a
        shift for you, you get a text. That’s it — no app to check, no schedule to
        refresh.
      </Block>

      <Block title="When we’ll text you">
        You’ll get a text with a link when there’s a trip you can crew. Tap the
        link to open your page. The link signs you in on that phone and stays
        signed in — so next time you can just open Muster from your home screen.
      </Block>

      <Block title="Answering an ask">
        An ask shows the day, time, boat, and role, then two buttons:
        <ul className="mt-1 ml-4 list-disc">
          <li>
            <b className="text-ink">In</b> — you’re on for the <b>whole day</b>.
            If the day has more than one trip, In takes them all.
          </li>
          <li>
            <b className="text-ink">Out</b> — you’re not available. No penalty,
            no explanation needed.
          </li>
        </ul>
        <span className="mt-1 block">
          Answer when you can. If the seat fills before you tap, we’ll tell you —
          nothing more needed.
        </span>
      </Block>

      <Block title="My shifts">
        Everything you’re confirmed on is under <b className="text-ink">My shifts</b>
        {" "}on your home page — tap one to see the call time, dock, and who else is
        aboard.
      </Block>

      <Block title="Messages">
        <b className="text-ink">Messages</b> is where notes from the office land. A
        number by it means something unread.
      </Block>

      <Block title="Pick up a shift">
        If there are open spots you’re cleared for, <b className="text-ink">Pick up
        a shift</b> lets you claim one yourself. Claiming locks you in for the
        whole day, same as tapping In.
      </Block>

      <Block title="Add Muster to your home screen">
        So you can reopen it like any app:
        <ul className="mt-1 ml-4 list-disc">
          <li>
            <b className="text-ink">iPhone (Safari):</b> tap the Share button, then
            “Add to Home Screen.”
          </li>
          <li>
            <b className="text-ink">Android (Chrome):</b> tap the ⋮ menu, then
            “Add to Home screen” / “Install app.”
          </li>
        </ul>
        <span className="mt-1 block">
          The icon opens straight to your shifts.
        </span>
      </Block>
    </Shell>
  );
}
