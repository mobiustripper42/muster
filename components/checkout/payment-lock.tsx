"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * One lock for the whole checkout screen while a payment is in flight (issue #1082 part A).
 *
 * The form body has gone `inert` during a payment since issue #997, but the page draws the header's
 * ‹ and the "Your trip" card's Change outside the form — so a guest could leave mid-charge and land
 * back on the date picker as if they had not paid. The form owns "a payment is in flight", and
 * this carries that to the parts of the screen the form does not draw.
 *
 * `inert`, like the form body's, for the same reasons: it takes a subtree out of hit-testing AND
 * the tab order, which a `pointer-events` overlay would not.
 */
const PaymentLockContext = createContext<{ locked: boolean; setLocked: (v: boolean) => void }>({
  locked: false,
  setLocked: () => {},
});

export function PaymentLockProvider({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false);
  return <PaymentLockContext.Provider value={{ locked, setLocked }}>{children}</PaymentLockContext.Provider>;
}

/** The form's side: say whether a payment is in flight. */
export function usePaymentLock(): (locked: boolean) => void {
  return useContext(PaymentLockContext).setLocked;
}

/** A part of the screen outside the form that must not be usable mid-payment. */
export function LockedWhilePaying({ className, children }: { className?: string; children: ReactNode }) {
  const { locked } = useContext(PaymentLockContext);
  return (
    <div inert={locked} className={className}>
      {children}
    </div>
  );
}
