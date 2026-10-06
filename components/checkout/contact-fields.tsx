"use client";

import { Input } from "../ui/input";

export interface ContactValues {
  name: string;
  phone: string;
  email: string;
}

/**
 * Who's booking (16.1d, issue #1092) — name, mobile, optional email, shared by the customer's
 * checkout and the operator's phone booking.
 *
 * **`voice` is copy, never behaviour.** The customer is told what happens to *their* details; the
 * operator is typing somebody else's, so the helpers speak about the guest, and autofill is off —
 * the browser would otherwise offer the operator's own name and number. Nothing here submits.
 *
 * Controlled, and the inputs carry `name`s, so the same fields serve a client `onSubmit` (the
 * customer's Stripe flow reads state) and a plain form post (the operator's server action reads
 * the FormData).
 */
export function ContactFields({
  voice,
  values,
  onChange,
}: {
  voice: "self" | "guest";
  values: ContactValues;
  onChange: (field: keyof ContactValues, value: string) => void;
}) {
  const self = voice === "self";
  return (
    <div className="pt-4">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-muted">
        Who&rsquo;s booking?
      </div>
      {/* Helper text sits under the field it describes, not under the group (#679). Email is
          optional and nothing said what skipping it costs — a guest who left it blank got no
          receipt and no warning. Now the trade is stated where the choice is made. */}
      <div className="flex flex-col gap-2">
        <Input
          className="w-full"
          name="customerName"
          placeholder={self ? "Full name" : "Guest’s full name"}
          autoComplete={self ? "name" : "off"}
          required
          value={values.name}
          onChange={(e) => onChange("name", e.target.value)}
        />
        <div>
          <Input
            className="w-full"
            name="phone"
            type="tel"
            // Just "Mobile" (operator, 2026-09-27): the callers are nearly all local, and the longer
            // hint was cut off at 375px. A non-US number still works — `+` and a country code — and
            // the refusal copy says so if one is typed without it.
            placeholder="Mobile"
            autoComplete={self ? "tel" : "off"}
            required
            value={values.phone}
            onChange={(e) => onChange("phone", e.target.value)}
          />
          <div className="mt-1 text-xs text-muted">
            {self
              ? "We’ll text you your booking link and trip updates."
              : "We’ll text them their booking link and trip updates."}
          </div>
        </div>
        <div>
          <Input
            className="w-full"
            name="email"
            type="email"
            placeholder="Email"
            autoComplete={self ? "email" : "off"}
            value={values.email}
            onChange={(e) => onChange("email", e.target.value)}
          />
          <div className="mt-1 text-xs text-muted">
            {self ? "Add an email if you want a copy of the receipt." : "Add an email if they want a copy of the receipt."}
          </div>
        </div>
      </div>
    </div>
  );
}
