"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * One lock for the whole checkout screen while a payment is in flight (issue #1082 part A).
 *
 * The form body has gone `inert` during a payment since issue #997, but the page draws the header's
 * ‹ and the "Your trip" card's Change outside the form — so a guest could leave mid-charge and land
 * back on the date picker as if they had not paid. This holds "a payment is in flight" for the
 * whole screen: the form switches it, and the parts the form does not draw lock with it.
 *
 * `inert`, like the form body's, for the same reasons: it takes a subtree out of hit-testing AND
 * the tab order, which a `pointer-events` overlay would not.
 *
 * **The flag lives HERE, and the form reads and writes it** — not a copy the form mirrors into this
 * from its own state. A mirrored copy lands one commit late (an effect runs after paint), so for a
 * frame the form was locked and ‹ was not (code review). One value, one render.
 *
 * **Fails loud without its provider**, like `useBooking` (`app/(public)/book/book-controls.tsx`). A
 * silent default here would mean a misplaced provider leaves ‹ live during a charge with nothing to
 * say so.
 */
type PaymentLock = { locked: boolean; setLocked: (v: boolean) => void };
const PaymentLockContext = createContext<PaymentLock | null>(null);

function usePaymentLockContext(): PaymentLock {
  const c = useContext(PaymentLockContext);
  if (!c) throw new Error("PaymentLockProvider is missing — the checkout screen must wrap its card in it");
  return c;
}

export function PaymentLockProvider({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false);
  return <PaymentLockContext.Provider value={{ locked, setLocked }}>{children}</PaymentLockContext.Provider>;
}

/** The form's side: whether a payment is in flight, and the switch. The form's own `submitting`. */
export function usePaymentLock(): PaymentLock {
  return usePaymentLockContext();
}

/**
 * A part of the screen outside the form that must not be usable mid-payment.
 *
 * **It greys out with the form, not only locks.** Part A made ‹ and Change inert, and the operator
 * found them still looking live beside a greyed form (2026-09-29). The form's grey is its busy
 * overlay, a `bg-card/70` wash over the body (`checkout-form.tsx`); this lays the same wash over
 * what it wraps, so the whole screen reads as one locked thing. `pointer-events-none`, like the
 * form's: `inert` is what locks, the wash only shows it.
 */
export function LockedWhilePaying({ className, children }: { className?: string; children: ReactNode }) {
  const { locked } = usePaymentLockContext();
  return (
    <div inert={locked} className={`relative ${className ?? ""}`}>
      {children}
      {locked && (
        <div aria-hidden="true" data-testid="locked-wash" className="pointer-events-none absolute inset-0 bg-card/70" />
      )}
    </div>
  );
}
