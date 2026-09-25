"use client";

import { useState } from "react";
import { CheckoutSummary } from "../../../../../components/checkout/checkout-summary";
import { ContactFields, type ContactValues } from "../../../../../components/checkout/contact-fields";
import type { CheckoutMoney, TipTier } from "../../../../../components/checkout/money";
import { PayBar } from "../../../../../components/checkout/pay-bar";
import { TipTiles } from "../../../../../components/checkout/tip-tiles";
import { SubmitButton } from "../../../../../components/ui/submit-button";
import { UnsavedGuard } from "../../../../../components/ui/unsaved-guard";
import { bookPhoneReservation } from "./actions";

/**
 * The operator's side of the checkout (16.1d, issue #1092) — the SAME contact fields, tip tiles,
 * money summary and pay bar a customer sees at `/book/checkout`, so the total read out on the
 * phone is the total the customer would be shown for that trip, party and tip.
 *
 * **What it leaves out, and why.** No card: the operator never types one (DEC-162; typing it is
 * 16.1c). No waiver: phone orders collect none (operator, 2026-09-23). No promo row and no
 * cancellation terms: this screen is read by the operator, not agreed to by the customer.
 *
 * **Submits as a plain server-action post**, not the customer's client `onSubmit` into Stripe:
 * `bookPhoneReservation` checks the admin and `bookForCustomer` owns every rule. The tip rides a
 * hidden input (`TipTiles`' `inputName`), the slot and party ride hidden inputs, and the contact
 * inputs carry their own names. So the pieces this shares with the public form submit nothing
 * themselves, and nothing on a public route can reach this action.
 */
export function PhoneBookingForm({
  slot,
  money,
  tiers,
  initial,
  restored,
}: {
  slot: { date: string; time: string; vesselId: string; offeringId: string; guests: number };
  money: CheckoutMoney;
  tiers: TipTier[];
  /** Defaults — the offering's preselected tip, or what the operator typed before a refusal. */
  initial: ContactValues & { gratuityBps: number };
  /** The fields were refilled from a refused submit: already unsaved, so guard from the start. */
  restored: boolean;
}) {
  const [contact, setContact] = useState<ContactValues>({
    name: initial.name,
    phone: initial.phone,
    email: initial.email,
  });
  const [tipBps, setTipBps] = useState(
    tiers.some((t) => t.bps === initial.gratuityBps) ? initial.gratuityBps : tiers[0]!.bps,
  );
  const tip = tiers.find((t) => t.bps === tipBps) ?? tiers[0]!;

  return (
    <form action={bookPhoneReservation} className="flex flex-col">
      <UnsavedGuard restored={restored} />
      <input type="hidden" name="date" value={slot.date} />
      <input type="hidden" name="time" value={slot.time} />
      <input type="hidden" name="vesselId" value={slot.vesselId} />
      <input type="hidden" name="offeringId" value={slot.offeringId} />
      <input type="hidden" name="guests" value={slot.guests} />

      <div className="px-4 pb-4">
        <ContactFields
          voice="guest"
          values={contact}
          onChange={(field, value) => setContact((c) => ({ ...c, [field]: value }))}
        />
        <TipTiles tiers={tiers} selectedBps={tip.bps} onSelect={setTipBps} inputName="gratuityBps" />
        <CheckoutSummary m={money} tipBps={tip.bps} tipCents={tip.tipCents} />
        <p className="pt-3 text-xs text-muted">
          This holds the boat until they pay or you cancel it — it never expires on its own. They
          agree to the waiver when they pay.
        </p>
      </div>

      <PayBar m={money} tipCents={tip.tipCents}>
        <span data-testid="book-phone" className="ml-auto">
          <SubmitButton className="rounded-[11px] bg-accent px-[22px] py-[13px] text-[14.5px] font-semibold text-white">
            Book it
          </SubmitButton>
        </span>
      </PayBar>
    </form>
  );
}
