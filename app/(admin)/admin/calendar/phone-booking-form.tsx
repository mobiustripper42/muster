"use client";

import { useState } from "react";
import { applyDiscount } from "@core/reservations/discount.js";
import { parseDollarsToCents } from "@core/reservations/dollars.js";
import { gratuityCentsFor } from "@core/reservations/pricing.js";
import { Field } from "../../../../components/ui/field";
import { Input } from "../../../../components/ui/input";
import { CheckoutSummary } from "../../../../components/checkout/checkout-summary";
import { ContactFields, type ContactValues } from "../../../../components/checkout/contact-fields";
import type { CheckoutMoney, TipTier } from "../../../../components/checkout/money";
import { PayBar } from "../../../../components/checkout/pay-bar";
import { TipTiles } from "../../../../components/checkout/tip-tiles";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { UnsavedGuard } from "../../../../components/ui/unsaved-guard";
import { bookPhoneReservation } from "./book-actions";

/**
 * The operator's side of the checkout (16.1d, issue #1092) — the SAME contact fields, tip tiles,
 * money summary and pay bar a customer sees at `/book/checkout`, so the total read out on the
 * phone is the total the customer would be shown for that trip, party and tip.
 *
 * **What it leaves out, and why.** No card: the operator never types one (DEC-162; typing it is
 * 16.1c). No terms box: the customer ticks it on the payment link (issue #1082, DEC-188). No promo row and no
 * cancellation terms: this screen is read by the operator, not agreed to by the customer.
 *
 * **What it adds: the discount box** (16.5, DEC-194) — the operator's own dollars off, which the
 * customer's checkout never has. Tax, fee, every tip tile and the total re-price on what is left.
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
  /** `view` is the calendar's Grid or List (issue #1079), so the booking returns to the one it came from. */
  slot: { date: string; time: string; vesselId: string; offeringId: string; guests: number; view: string };
  money: CheckoutMoney;
  tiers: TipTier[];
  /** Defaults — the offering's preselected tip, or what the operator typed before a refusal. */
  initial: ContactValues & { gratuityBps: number; discount: string };
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
  const [discount, setDiscount] = useState(initial.discount);
  // The money on screen, re-totalled as the box is typed in — through `applyDiscount`, the same
  // function `priceBooking` freezes with, so what is read out on the phone is what is charged.
  // A value that doesn't parse prices as no discount; the server refuses it by name on Book it.
  const parsed = discount.trim() === "" ? 0 : parseDollarsToCents(discount);
  const d = applyDiscount({
    fareAndExtrasCents: money.fareCents,
    requestedCents: parsed ?? 0,
    taxRateBps: money.taxRateBps,
    serviceFeeBps: money.serviceFeeBps,
    gratuityBps: tipBps,
  });
  const shownTiers = tiers.map((t) => ({ bps: t.bps, tipCents: gratuityCentsFor(d.baseCents, t.bps) }));
  const tip = shownTiers.find((t) => t.bps === tipBps) ?? shownTiers[0]!;
  const shown: CheckoutMoney = {
    ...money,
    discountCents: d.discountCents,
    taxCents: d.taxCents,
    serviceFeeCents: d.serviceFeeCents,
    dueNowBeforeTipCents: d.baseCents + d.taxCents + d.serviceFeeCents,
  };

  return (
    <form action={bookPhoneReservation} className="flex flex-col">
      <UnsavedGuard restored={restored} />
      <input type="hidden" name="date" value={slot.date} />
      <input type="hidden" name="time" value={slot.time} />
      <input type="hidden" name="vesselId" value={slot.vesselId} />
      <input type="hidden" name="offeringId" value={slot.offeringId} />
      <input type="hidden" name="guests" value={slot.guests} />
      <input type="hidden" name="view" value={slot.view} />

      <div className="px-4 pb-4">
        <ContactFields
          voice="guest"
          values={contact}
          onChange={(field, value) => setContact((c) => ({ ...c, [field]: value }))}
        />
        <TipTiles tiers={shownTiers} selectedBps={tip.bps} onSelect={setTipBps} inputName="gratuityBps" />
        {/* Deposits are not in use (§2.8.4a), and the box re-totals in full-payment terms only. */}
        {money.depositMode ? null : (
          <DiscountBox value={discount} onChange={setDiscount} invalid={parsed === null} comped={d.comped} />
        )}
        <CheckoutSummary m={shown} tipBps={tip.bps} tipCents={tip.tipCents} />
        <p className="pt-3 text-xs text-muted">
          {d.comped
            ? "Nothing to pay, so no payment link is sent. It books straight away and they get their confirmation."
            : "This holds the boat until they pay or you cancel it — it never expires on its own. They agree to the cancellation terms when they pay."}
        </p>
      </div>

      <PayBar m={shown} tipCents={tip.tipCents}>
        <span data-testid="book-phone" className="ml-auto">
          <SubmitButton className="btn-primary btn-lg">
            Book it
          </SubmitButton>
        </span>
      </PayBar>
    </form>
  );
}

/**
 * The discount box (16.5, DEC-194) — one number, in dollars, off the fare. Blank is none. The
 * comp line appears the moment what is left due drops under $2, before anything is saved, so the
 * operator is never surprised by a bigger discount than they typed.
 */
function DiscountBox({
  value,
  onChange,
  invalid,
  comped,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  comped: boolean;
}) {
  return (
    <Field label="Discount" hint="dollars off the fare" htmlFor="discount" className="pt-5">
      <Input
        id="discount"
        name="discount"
        type="text"
        inputMode="decimal"
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="discount"
        // Right-aligned, so the figure lines up with the money column in the summary below it.
        className="w-full text-right font-mono"
      />
      {invalid ? (
        <span className="text-xs text-bad">Enter dollars, like 50 or 49.99.</span>
      ) : null}
      {comped ? (
        <span className="text-xs text-ok" data-testid="discount-comp">
          Under $2 due — this will be a comp.
        </span>
      ) : null}
    </Field>
  );
}
