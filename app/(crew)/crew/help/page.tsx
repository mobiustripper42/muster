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

      <Block title="Signing in">
        Two ways in:
        <ul className="mt-1 ml-4 list-disc">
          <li>
            <b className="text-ink">From an ask</b> — when there’s a trip for you, you
            get a text with a <b>link</b>. Tap it and it opens the ask <i>and</i> signs
            you in, no code needed.
          </li>
          <li>
            <b className="text-ink">Any other time</b> — open Muster and enter your
            <b> email</b>; we text you a <b>6-digit code</b>. Type it in and you’re in.
          </li>
        </ul>
        <span className="mt-1 block">
          Either way you stay signed in for about two weeks, so most days you just open
          Muster from your home screen and it’s already you.
        </span>
      </Block>

      <Block title="Answering an ask">
        An ask shows the day, time, boat, and role, then two buttons:
        <ul className="mt-1 ml-4 list-disc">
          <li>
            <b className="text-ink">Yes</b> — you’re on for <b>that shift</b> (the one
            on the card). Just that shift — not a standing commitment.
          </li>
          <li>
            <b className="text-ink">No</b> — you’re not available for this one.
          </li>
        </ul>
        <span className="mt-1 block">
          If the seat fills before you tap, we’ll tell you — nothing more needed.
        </span>
      </Block>

      <Block title="Why we ask you to answer — even No">
        Everyone has a quiet <b className="text-ink">reliability score</b>. It isn’t a
        grade and it isn’t a gate on what you’re qualified for — the only thing it does
        is set who gets asked <b>first</b>. Here’s the deal, and it’s meant to be fair:
        <ul className="mt-1 ml-4 list-disc">
          <li>
            A quick <b className="text-ink">No</b> costs you nothing — it’s a real
            answer, and it frees Muster to ask the next person right away instead of
            waiting on you.
          </li>
          <li>
            The one thing that hurts is <b>silence</b> — an ask nobody answers is what
            leaves a boat short at the last minute. So ignoring an ask is what pulls
            your score down, not saying no.
          </li>
          <li>
            Bailing on a shift you already took hurts by <i>how late</i> it is — days
            ahead is cheap, an hour before is not, a no-show is the worst.
          </li>
        </ul>
        <span className="mt-1 block">
          Answer quickly either way and you drift <b>up</b> the order — you’ll see more
          shifts and get first crack at them. That’s the whole point of the score: the
          people the office can count on get asked first.
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
        a shift</b> lets you claim one yourself. This one’s different from answering
        an ask: claiming an open shift puts you on for the <b>whole day</b>, not just
        a single trip.
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
            “Install app” (some phones say “Add to Home screen”). If you opened
            Muster from a text, do this in Chrome, not the in-app browser.
          </li>
        </ul>
        <span className="mt-1 block">
          The icon opens straight to your shifts.
        </span>
      </Block>
    </Shell>
  );
}
