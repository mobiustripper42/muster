import { formatPhoneForDisplay, type CanonicalPhone } from "@core/customers/identity.js";
import { tel } from "../../app/lib/format";

/**
 * ` at (216) 555-0100`, the number a `tel:` link, or nothing when no number is stored (issue #1159).
 * The same words as `atContactPhone` in `src/reservations/contact-phone.ts`; the two are separate
 * because a string cannot carry a link, and a test holds them equal.
 */
export function AtContactPhone({ phone }: { phone: CanonicalPhone | null }) {
  if (phone === null) return null;
  return (
    <>
      {" at "}
      <a href={tel(phone)} className="text-accent">
        {formatPhoneForDisplay(phone)}
      </a>
    </>
  );
}

/** `Call us at (216) 555-0100 and we’ll book it for you`: the same words as `callUsToBook`. */
export function CallUsToBook({ phone }: { phone: CanonicalPhone | null }) {
  return (
    <>
      Call us
      <AtContactPhone phone={phone} />
      {" and we’ll book it for you"}
    </>
  );
}
