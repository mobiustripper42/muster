/**
 * "Lost your booking link?" (12.7, issue #460) — the public recovery form.
 *
 * **Why this route sits at `/b/find`, beside `/b/[code]`:** it is the same surface from the
 * customer's point of view, and Next resolves a static segment before a dynamic one, so `find`
 * can never be read as a booking code. `normalizeBookingCode` would reject it anyway (it isn't
 * 14 characters), but relying on that would mean this page's existence depended on a validator
 * in another module. There is an e2e that pins both directions.
 *
 * **The page never renders a link, and never says whether anything matched.** Submitting always
 * lands on the same confirmation. That is not politeness — a form that says "no booking with that
 * email" tells a stranger who has booked with this operator, and one that varies its wording does
 * the same thing more quietly. `recoverBookingLink` returns `void` so this page has nothing to
 * branch on even by accident.
 *
 * No client JS: a plain server-action form, per DEC-026.
 */
import { AppLink } from "../../../components/ui/app-link";
import { Notice } from "../../../components/ui/notice";
import { SubmitButton } from "../../../components/ui/submit-button";
import { requestBookingLink } from "./actions";
import { reservationsEnabled } from "../../lib/flags";

export const dynamic = "force-dynamic";

export default async function FindBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  if (!reservationsEnabled()) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-xl font-semibold">Reservations are off</h1>
      </main>
    );
  }

  const { sent } = await searchParams;

  return (
    <main className="mx-auto max-w-lg px-3 py-8 sm:px-4 sm:py-12">
      <div className="overflow-hidden rounded-[18px] border border-line bg-card shadow-sm">
        <div className="border-b border-line bg-gradient-to-br from-accent/10 to-transparent px-5 py-4">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Find your booking
          </span>
          <h1 className="mt-1.5 text-[19px] font-semibold">Lost your link?</h1>
        </div>

        <div className="px-5 py-5">
          {sent === "1" ? (
            // The SAME message whether or not anything matched. Deliberately says "if we find" —
            // it does not claim a booking exists, and it does not claim one doesn't.
            <>
              <Notice tone="ok">
                Thanks — if we find a booking that matches, we&rsquo;ll text and email your link to
                the contact details we have on file. It should arrive in a minute or two.
              </Notice>
              <p className="mt-4 text-[12.5px] text-muted">
                Nothing arrived? Check the details you entered match the ones you booked with, or
                give us a call and we&rsquo;ll sort it out.
              </p>
            </>
          ) : (
            <>
              <p className="mb-4 text-[13px] text-muted">
                Enter the email or phone number you booked with and we&rsquo;ll send your booking
                link back to you. We only ever send it to the contact details already on the
                booking.
              </p>
              <form action={requestBookingLink} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-ink">Email or phone</span>
                  <input
                    name="contact"
                    required
                    autoComplete="email"
                    placeholder="you@example.com or (216) 555-0148"
                    className="min-h-[44px] w-full rounded-[10px] border border-line bg-bg px-3 text-[15px] text-ink placeholder:text-faint"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-ink">Last name</span>
                  <input
                    name="lastName"
                    required
                    autoComplete="family-name"
                    placeholder="Webb"
                    className="min-h-[44px] w-full rounded-[10px] border border-line bg-bg px-3 text-[15px] text-ink placeholder:text-faint"
                  />
                </label>
                <SubmitButton className="min-h-[44px] rounded-[10px] bg-accent px-4 text-[14px] font-semibold text-white">
                  Send me my link
                </SubmitButton>
              </form>
            </>
          )}

          <p className="mt-5 border-t border-line-soft pt-4 text-[12.5px] text-muted">
            Haven&rsquo;t booked yet?{" "}
            <AppLink href="/book" className="text-accent">
              See what&rsquo;s available
            </AppLink>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
